"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Gift,
  Copy,
  Check,
  Download,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Lock,
} from "lucide-react";
import type { RewardRarity } from "../../lib/rewards-catalog";
import { REWARDS_CATALOG, calculateDropRates } from "../../lib/rewards-catalog";

interface ClaimRewardData {
  code: string;
  claimNumber: number;
  bg: {
    id: string;
    name: string;
    rarity: RewardRarity;
    description: string;
    previewColor: string;
    previewUrl?: string | null;
  };
}

interface NotchiClaimRewardProps {
  locale?: string;
  totalDownloads: number;
  milestoneTarget?: number;
  siteKey?: string;
}

const STORAGE_KEY = "notchi_reward_claim";

export default function NotchiClaimReward({
  locale = "en",
  totalDownloads,
  milestoneTarget = 100,
  siteKey = "",
}: NotchiClaimRewardProps) {
  const isId = locale === "id";

  const [isOpen, setIsOpen] = useState<boolean | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimData, setClaimData] = useState<ClaimRewardData | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // 1. Load stored claim & check server status on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setClaimData(JSON.parse(stored));
      }
    } catch {
      // Ignore local storage parse error
    }

    async function checkStatus() {
      try {
        const res = await fetch("/api/claim-status");
        const reached = totalDownloads >= (milestoneTarget || 100);
        if (res.ok) {
          const json = await res.json();
          setIsOpen(Boolean(json.isOpen) || reached);
        } else {
          setIsOpen(reached);
        }
      } catch {
        setIsOpen(totalDownloads >= (milestoneTarget || 100));
      } finally {
        setIsLoadingStatus(false);
      }
    }

    checkStatus();
  }, []);

  // 2. Render Cloudflare Turnstile if available
  useEffect(() => {
    if (!isOpen || claimData) return;

    const renderTurnstile = () => {
      // @ts-expect-error Turnstile window object
      if (window.turnstile && turnstileContainerRef.current && !widgetIdRef.current) {
        // @ts-expect-error Turnstile render
        widgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
          sitekey: siteKey || "1x00000000000000000000AA", // Cloudflare test key if not set
          theme: "dark",
          callback: (token: string) => setTurnstileToken(token),
          "error-callback": () => setTurnstileToken(""),
        });
      }
    };

    if (siteKey) {
      // Check if turnstile script already loaded
      // @ts-expect-error Turnstile window object
      if (window.turnstile) {
        renderTurnstile();
      } else {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.onload = renderTurnstile;
        document.head.appendChild(script);
      }
    }
  }, [isOpen, claimData, siteKey]);

  // Handle claim submission
  const handleClaim = async () => {
    setIsClaiming(true);
    setErrorMessage("");

    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstileToken: turnstileToken || "dev-bypass" }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        if (json.error === "already_claimed") {
          throw new Error(
            isId
              ? "Anda sudah pernah melakukan klaim hadiah. Setiap pengguna hanya berhak mendapatkan 1 kode klaim."
              : "You have already claimed a reward code. Only 1 claim is allowed per user."
          );
        } else if (json.error === "rate_limited") {
          throw new Error(
            isId
              ? "Terlalu banyak permintaan. Silakan tunggu beberapa saat lagi."
              : "Too many requests. Please wait a moment before trying again."
          );
        } else if (json.error === "claims_closed") {
          throw new Error(
            isId ? "Sesi klaim saat ini sedang ditutup." : "Reward claims are currently closed."
          );
        } else {
          throw new Error(json.message || (isId ? "Gagal mengklaim hadiah." : "Failed to claim reward."));
        }
      }

      const newClaim: ClaimRewardData = {
        code: json.code,
        claimNumber: json.claimNumber,
        bg: json.bg,
      };

      setClaimData(newClaim);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newClaim));
      } catch {
        // Ignore localStorage quota
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Error processing claim");
    } finally {
      setIsClaiming(false);
      // Reset Turnstile token
      // @ts-expect-error Turnstile reset
      if (window.turnstile && widgetIdRef.current) {
        // @ts-expect-error Turnstile reset
        window.turnstile.reset(widgetIdRef.current);
      }
    }
  };

  const handleCopyCode = () => {
    if (!claimData) return;
    navigator.clipboard.writeText(claimData.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTxt = () => {
    if (!claimData) return;
    const content = [
      `=== NOTCHI MILESTONE REWARD ===`,
      `Claim Number : #${String(claimData.claimNumber).padStart(4, "0")}`,
      `Reward Item  : ${claimData.bg.name} (${claimData.bg.rarity.toUpperCase()})`,
      `Claim Code   : ${claimData.code}`,
      `Issued At    : ${new Date().toISOString()}`,
      ``,
      `--- HOW TO REDEEM ---`,
      `1. Open Notchi on your Windows PC.`,
      `2. Open Settings -> Rewards / Custom Themes tab.`,
      `3. Enter your code: ${claimData.code}`,
      `4. Click Redeem to unlock your custom background.`,
      ``,
      `Note: Keep this code safe. Without accounts, this code is required to restore your reward.`,
    ].join("\r\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `notchi-reward-${claimData.code}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getRarityBadge = (rarity: RewardRarity) => {
    switch (rarity) {
      case "legendary":
        return "border-pink-500/40 bg-pink-500/10 text-pink-400";
      case "epic":
        return "border-purple-500/40 bg-purple-500/10 text-purple-400";
      case "rare":
        return "border-sky-500/40 bg-sky-500/10 text-sky-400";
      default:
        return "border-neutral-700 bg-neutral-800 text-neutral-300";
    }
  };

  const progressPercent = Math.min(100, Math.round((totalDownloads / milestoneTarget) * 100));

  return (
    <div className="w-full max-w-4xl mx-auto space-y-12">
      {/* 1. Milestone Counter & Status Banner */}
      <div className="border border-neutral-800 bg-neutral-900/40 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-neutral-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-blue-400 font-medium">
                {isId ? "Progres Target Komunitas" : "Community Milestone Goal"}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold text-white tracking-tight mt-1">
              {totalDownloads} / {milestoneTarget} Downloads
            </h2>
            <p className="text-xs text-neutral-400 mt-1">
              {isId
                ? "Total akumulasi unduhan installer Notchi di seluruh rilis publik."
                : "Accumulated installer downloads across all public releases."}
            </p>
          </div>

          <div className="flex items-center">
            {isLoadingStatus ? (
              <span className="inline-flex items-center gap-1.5 border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-mono text-neutral-400">
                <RefreshCw className="size-3 animate-spin" />
                {isId ? "Memeriksa status..." : "Checking status..."}
              </span>
            ) : isOpen ? (
              <span className="inline-flex items-center gap-1.5 border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs font-mono text-blue-400 font-semibold">
                <span className="size-2 rounded-full bg-blue-400 animate-pulse" />
                {isId ? "KLAIM DIBUKA" : "CLAIMS OPEN"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-mono text-neutral-400 font-semibold">
                {isId ? "SEGERA HADIR" : "COMING SOON"}
              </span>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-6">
          <div className="flex justify-between text-xs font-mono text-neutral-400 mb-2">
            <span>Milestone 100 Downloads</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-2 w-full bg-neutral-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-700"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. Main Claim Box */}
      <div className="border border-neutral-800 bg-neutral-950 p-6 sm:p-10">
        {claimData ? (
          /* RESULT STATE: ALREADY CLAIMED / RECENTLY CLAIMED */
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="text-center max-w-xl mx-auto space-y-2">
              <div className="inline-flex items-center gap-2 border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-mono text-blue-400">
                <Sparkles className="size-3.5" />
                <span>{isId ? "Hadiah Berhasil Diklaim!" : "Reward Unlocked!"}</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                {claimData.bg.name}
              </h3>
              <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed font-normal">
                {claimData.bg.description}
              </p>
            </div>

            {/* Visual Preview Box */}
            <div
              className="relative w-full h-40 sm:h-52 border border-neutral-800 flex items-center justify-between p-6 overflow-hidden bg-neutral-950"
              style={{ background: claimData.bg.previewColor }}
            >
              <img
                src={claimData.bg.previewUrl || `/images/rewards/${claimData.bg.id}_teaser.webp`}
                alt={claimData.bg.name}
                className="absolute inset-0 w-full h-full object-cover object-center blur-md scale-110"
              />
              <div className="absolute inset-0 bg-neutral-950/60 backdrop-blur-[1px]" />
              <div className="relative z-10 bg-neutral-950/90 backdrop-blur-md border border-neutral-800 p-4 max-w-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${getRarityBadge(
                      claimData.bg.rarity
                    )}`}
                  >
                    {claimData.bg.rarity}
                  </span>
                  <span className="text-xs font-mono text-neutral-400">
                    #{String(claimData.claimNumber).padStart(4, "0")}
                  </span>
                </div>
                <h4 className="text-base font-semibold text-white mt-1.5">{claimData.bg.name}</h4>
              </div>

              <div className="relative z-10 hidden sm:block text-right bg-neutral-950/80 backdrop-blur-md border border-neutral-800 px-3 py-2">
                <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest block">
                  Notchi Theme
                </span>
                <span className="text-xs font-mono text-white font-medium">Edition v2</span>
              </div>
            </div>

            {/* Code Box */}
            <div className="border border-neutral-800 bg-neutral-900/60 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] font-mono text-neutral-500 uppercase tracking-wider block">
                    {isId ? "Kode Klaim Anda" : "Your Claim Code"}
                  </span>
                  <span className="text-xl sm:text-2xl font-mono font-bold text-emerald-400 tracking-wider">
                    {claimData.code}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyCode}
                    className="inline-flex h-9 items-center justify-center gap-2 border border-neutral-800 bg-neutral-900 px-4 text-xs font-mono font-medium text-neutral-200 hover:text-white hover:bg-neutral-800 transition-colors"
                  >
                    {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                    <span>{copied ? (isId ? "Tersalin!" : "Copied!") : isId ? "Salin Kode" : "Copy Code"}</span>
                  </button>

                  <button
                    onClick={handleDownloadTxt}
                    className="inline-flex h-9 items-center justify-center gap-2 bg-blue-600 px-4 text-xs font-mono font-medium text-white hover:bg-blue-500 transition-colors"
                  >
                    <Download className="size-3.5" />
                    <span>{isId ? "Unduh .txt" : "Download .txt"}</span>
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2.5 pt-3 border-t border-neutral-800/80 text-xs text-neutral-400">
                <AlertCircle className="size-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  {isId
                    ? "Simpan kode ini dengan aman. Tanpa sistem login/akun, kode ini adalah satu-satunya bukti kepemilikan untuk mengaktifkan reward di aplikasi Notchi PC Anda (maksimal 3 perangkat)."
                    : "Save this code securely. Without user accounts, this code is the only way to activate or restore your reward in the Notchi PC application (up to 3 devices)."}
                </p>
              </div>
            </div>
          </div>
        ) : isOpen ? (
          /* ACTION STATE: CLAIMS ARE OPEN */
          <div className="max-w-xl mx-auto space-y-6 text-center">
            <div className="inline-flex items-center gap-2 border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-mono text-blue-400">
              <Gift className="size-3.5" />
              <span>{isId ? "Sesi Klaim Terbuka" : "Claim Session Open"}</span>
            </div>

            <div className="space-y-2">
              <h3 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
                {isId ? "Undi Background Notchi Anda" : "Draw Your Notchi Custom Background"}
              </h3>
              <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed font-normal">
                {isId
                  ? "Satu klik untuk mengundi desain latar belakang notch eksklusif dengan sistem probabilitas acak transparan."
                  : "One-click draw for an exclusive notch background design with transparent random probabilities."}
              </p>
            </div>

            {/* Turnstile Container */}
            <div className="flex justify-center py-2">
              <div ref={turnstileContainerRef} />
            </div>

            {errorMessage && (
              <div className="flex items-center justify-center gap-2 text-xs font-mono text-rose-400">
                <AlertCircle className="size-3.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              onClick={handleClaim}
              disabled={isClaiming || (Boolean(siteKey) && !turnstileToken)}
              className="inline-flex h-11 items-center justify-center gap-2 bg-blue-600 px-8 text-sm font-mono font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
            >
              {isClaiming ? (
                <>
                  <RefreshCw className="size-4 animate-spin" />
                  <span>{isId ? "Mengundi Hadiah..." : "Rolling Reward..."}</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  <span>{isId ? "Klaim Hadiah Sekarang" : "Claim Reward Now"}</span>
                </>
              )}
            </button>
          </div>
        ) : (
          /* COMING SOON STATE */
          <div className="max-w-xl mx-auto text-center space-y-4 py-6">
            <div className="inline-flex size-12 items-center justify-center border border-neutral-800 bg-neutral-900 text-neutral-400 mx-auto">
              <ShieldCheck className="size-6 text-neutral-500" />
            </div>
            <h3 className="text-xl sm:text-2xl font-semibold text-white">
              {isId ? "Sesi Klaim Segera Dibuka" : "Reward Claims Coming Soon"}
            </h3>
            <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed font-normal">
              {isId
                ? "Sesi klaim hadiah sedang dipersiapkan dan akan dibuka secara manual setelah target milestone unduhan tercapai atau saat versi pembaruan Notchi dirilis."
                : "The reward claim session is currently being prepared and will be opened once community milestones are achieved or when the next Notchi desktop version is officially published."}
            </p>
          </div>
        )}
      </div>

      {/* 3. 3-Step Redeem Walkthrough */}
      <div className="border border-neutral-800 bg-neutral-900/30 p-6 sm:p-8 space-y-6">
        <div>
          <span className="text-xs font-mono text-neutral-500 uppercase tracking-wider block">
            {isId ? "Panduan Aplikasi" : "Application Guide"}
          </span>
          <h3 className="text-lg font-semibold text-white tracking-tight mt-1">
            {isId ? "Cara Menukarkan Kode di Notchi PC" : "How to Redeem Your Code in Notchi PC"}
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-neutral-800/80 pt-6">
          <div className="border border-neutral-800/80 bg-neutral-950 p-4 space-y-2">
            <span className="text-xs font-mono font-bold text-blue-400">01</span>
            <h4 className="text-xs font-semibold text-white font-sans">
              {isId ? "Buka Pengaturan" : "Open Settings"}
            </h4>
            <p className="text-xs text-neutral-400 leading-relaxed font-normal">
              {isId
                ? "Buka aplikasi Notchi di PC Anda. Klik kanan area notch atau ikon baki untuk membuka Pengaturan."
                : "Launch Notchi on Windows. Right-click the notch or tray icon to open Settings."}
            </p>
          </div>

          <div className="border border-neutral-800/80 bg-neutral-950 p-4 space-y-2">
            <span className="text-xs font-mono font-bold text-blue-400">02</span>
            <h4 className="text-xs font-semibold text-white font-sans">
              {isId ? "Menu Hadiah / Tema" : "Rewards Tab"}
            </h4>
            <p className="text-xs text-neutral-400 leading-relaxed font-normal">
              {isId
                ? "Pilih menu 'Hadiah & Tema Kustom' di panel navigasi samping."
                : "Select 'Rewards & Custom Themes' in the navigation sidebar."}
            </p>
          </div>

          <div className="border border-neutral-800/80 bg-neutral-950 p-4 space-y-2">
            <span className="text-xs font-mono font-bold text-blue-400">03</span>
            <h4 className="text-xs font-semibold text-white font-sans">
              {isId ? "Tukarkan Kode" : "Enter Code"}
            </h4>
            <p className="text-xs text-neutral-400 leading-relaxed font-normal">
              {isId
                ? "Tempel kode klaim Anda lalu klik Tukarkan. Background eksklusif Anda langsung aktif."
                : "Paste your claim code and click Redeem. Your exclusive background will unlock instantly."}
            </p>
          </div>
        </div>
      </div>

      {/* 4. Exclusive Rewards Preview Showcase */}
      <div className="border border-neutral-800 bg-neutral-950 p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800/80 pb-4">
          <div>
            <span className="text-xs font-mono text-blue-400 uppercase tracking-wider block">
              {isId ? "Koleksi Hadiah Milestone" : "Milestone Reward Collection"}
            </span>
            <h3 className="text-lg font-semibold text-white tracking-tight mt-1">
              {isId ? "Pratinjau Background Eksklusif" : "Exclusive Background Previews"}
            </h3>
          </div>
          <span className="text-xs font-mono text-neutral-400">
            {isId ? "Tersedia di Notchi PC" : "Compatible with Notchi PC"}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {calculateDropRates().map((rate) => {
            const item = REWARDS_CATALOG.find((r) => r.id === rate.id)!;
            const rarityStyle: Record<string, { border: string; text: string; label: string }> = {
              legendary: { border: "border-yellow-500/40", text: "text-yellow-400", label: "Legendary" },
              epic:      { border: "border-purple-500/40", text: "text-purple-400", label: "Epic" },
              rare:      { border: "border-blue-500/40",   text: "text-blue-400",   label: "Rare" },
              common:    { border: "border-neutral-500/40", text: "text-neutral-400", label: "Common" },
            };
            const style = rarityStyle[item.rarity] ?? rarityStyle.common;
            return (
              <div key={item.id} className="border border-neutral-800 bg-neutral-900/40 p-4 space-y-4 rounded-none group hover:border-blue-500/50 transition-colors">
                <div className="relative aspect-[16/9] w-full overflow-hidden border border-neutral-800 bg-neutral-950">
                  {item.image && (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-full h-full object-cover object-center blur-md scale-110 group-hover:scale-125 transition-transform duration-700"
                      loading="lazy"
                    />
                  )}
                  <div className="absolute inset-0 bg-neutral-950/30 flex items-center justify-center">
                    <span className="inline-flex items-center gap-1.5 border border-neutral-700/80 bg-neutral-950/80 px-2.5 py-1 text-[11px] font-mono text-neutral-300 backdrop-blur-md">
                      <Lock className="size-3 text-blue-400" />
                      <span>{isId ? "Teaser Rahasia" : "Mystery Teaser"}</span>
                    </span>
                  </div>
                  <div className="absolute top-2.5 left-2.5">
                    <span className={`border ${style.border} bg-neutral-950/80 backdrop-blur-md px-2 py-0.5 text-[10px] font-mono ${style.text} uppercase font-semibold`}>
                      {style.label}
                    </span>
                  </div>
                  {item.quota && (
                    <div className="absolute top-2.5 right-2.5">
                      <span className="border border-amber-500/50 bg-amber-950/80 backdrop-blur-md px-2 py-0.5 text-[10px] font-mono text-amber-300 font-semibold uppercase tracking-wider">
                        {isId ? `Batas ${item.quota} Unit` : `Limit: ${item.quota} Only`}
                      </span>
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <h4 className="text-base font-semibold text-white tracking-tight">{item.name}</h4>
                    <span className="text-xs font-mono text-blue-400 font-medium">{rate.percentage}% Rate</span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1 leading-relaxed">{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
