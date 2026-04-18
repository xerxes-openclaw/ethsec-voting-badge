import { useState } from "react";
import { OnlineApp } from "./components/OnlineApp.js";
import { OfflineApp } from "./components/OfflineApp.js";
import { AdminPage } from "./components/AdminPage.js";
import { Decor } from "./components/Decor.js";

type View = "landing" | "online" | "offline" | "admin";

export default function App(): JSX.Element {
  const [view, setView] = useState<View>("landing");

  if (view === "online") return <OnlineApp onBack={() => setView("landing")} />;
  if (view === "offline") return <OfflineApp onBack={() => setView("landing")} />;
  if (view === "admin") return <AdminPage onBack={() => setView("landing")} />;

  return (
    <section className="relative min-h-screen overflow-hidden pt-16 pb-24">
      <Decor />

      <div className="relative z-10 max-w-[1100px] mx-auto px-6">
        {/* Hero video — lifted from thedao.fund/ethsecurity-badges */}
        <div className="flex justify-center mb-10 animate-scaleIn">
          <video
            autoPlay
            loop
            muted
            playsInline
            src="/eth-security-badge.mp4"
            className="max-w-sm w-full rounded-full shadow-2xl shadow-dao-green/20"
          />
        </div>

        <header className="text-center mb-14 space-y-4 animate-fadeIn">
          <h1 className="font-tight text-5xl md:text-6xl font-semibold tracking-tight leading-tight">
            Voting Badge
          </h1>
          <p className="text-xl text-dao-green font-light">
            Private voting for ETHSecurity badge holders
          </p>
          <p className="text-gray-300 text-base md:text-lg max-w-2xl mx-auto leading-relaxed pt-2">
            Submit a voting address tied to your badge. It&apos;s encrypted in the
            browser, decrypted offline by the admin after voting closes.
            Your plaintext choice never leaves your device.
          </p>
        </header>

        {/* Mode buttons */}
        <div className="w-full h-px bg-gradient-to-r from-transparent via-dao-green/50 to-transparent mb-10" />

        <section className="grid md:grid-cols-2 gap-6 animate-fadeIn">
          <ModeCard
            onClick={() => setView("online")}
            title="Online"
            badge="normal"
            badgeClass="bg-dao-green/15 text-dao-green ring-dao-green/30"
            description="Connect your wallet in this browser, sign the voting message, and submit. The fast path."
            bullets={[
              "RainbowKit + any supported wallet",
              "Auto-detects your badge tokenId onchain",
              "One click to submit once signed",
            ]}
          />
          <ModeCard
            onClick={() => setView("offline")}
            title="Offline"
            badge="airgapped"
            badgeClass="bg-dao-red/15 text-dao-red ring-dao-red/30"
            description="For signers whose keys live on an airgapped machine. Sign locally, export a blob, submit later from an online machine."
            bullets={[
              "Run this page on an offline machine",
              "Sign via a local wallet OR copy-paste EIP-712",
              "Upload the signed blob from any online machine",
            ]}
          />
        </section>

        <div className="w-full h-px bg-gradient-to-r from-transparent via-dao-green/50 to-transparent mt-10" />

        <footer className="text-center text-xs text-white/40 pt-8 space-y-2">
          <p>ETHSecurity Voting Badge &middot; TheDAO Security Fund</p>
          <button
            onClick={() => setView("admin")}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            Admin
          </button>
        </footer>
      </div>
    </section>
  );
}

interface ModeCardProps {
  onClick: () => void;
  title: string;
  badge: string;
  badgeClass: string;
  description: string;
  bullets: string[];
}

function ModeCard({ onClick, title, badge, badgeClass, description, bullets }: ModeCardProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative text-left rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-7 hover:border-dao-green/50 transition-all duration-300 overflow-hidden"
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-dao-green/0 to-dao-green/0 group-hover:from-dao-green/10 group-hover:to-dao-green/5 transition-all duration-300" />
      <div className="relative z-10">
        <div className="flex items-start justify-between">
          <h2 className="font-tight text-2xl font-semibold text-white">{title}</h2>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${badgeClass}`}>
            {badge}
          </span>
        </div>
        <p className="mt-3 text-sm text-gray-300 leading-relaxed">{description}</p>
        <ul className="mt-4 space-y-2">
          {bullets.map((b) => (
            <li key={b} className="text-xs text-gray-400 flex gap-2 leading-relaxed">
              <span className="text-dao-green">▸</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-dao-green group-hover:gap-2.5 transition-all">
          Open <span>→</span>
        </div>
      </div>
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 shadow-xl shadow-dao-green/20 pointer-events-none" />
    </button>
  );
}
