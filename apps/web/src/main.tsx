import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import App from "./App.js";
import { wagmiConfig } from "./wagmi.js";
import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";

const queryClient = new QueryClient();

/**
 * DAO.fund-themed RainbowKit dark theme.
 * Accent: brand blue (#2C5EB6), font: Inter.
 */
const theme = darkTheme({
  accentColor: "#2C5EB6",
  accentColorForeground: "#ffffff",
  borderRadius: "medium",
  fontStack: "system",
});

// Override a few tokens to match DAO.fund dark navy palette
theme.colors.modalBackground = "#1a2e4a";
theme.colors.profileForeground = "#1e3a5f";
theme.fonts.body = "Inter, system-ui, sans-serif";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact">
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
