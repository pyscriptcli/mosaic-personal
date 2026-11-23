import type { Metadata } from "next";
import "./globals.css";
import { StudioRecorderProvider } from "@/features/notetaker/components/StudioRecorderProvider";
import { ClickUpLoadingProvider } from "@/components/ClickUpLoadingProvider";
import { EchoAIProvider } from "@/features/ask-echo/components/EchoAI";

export const metadata: Metadata = {
  title: {
    default: "Mosaic — Work, Connected",
    template: "%s | Mosaic",
  },
  description: "Mosaic brings your team’s essential tools into one connected workspace.",
  icons: {
    icon: "/mosaic-app-icon.svg",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html 
      lang="en" 
      className="h-full w-full"
    >
      <head><meta name="color-scheme" content="dark" /></head>
      <body className="h-full w-full bg-surface-canvas font-sans antialiased text-fg overflow-hidden">
        <EchoAIProvider><ClickUpLoadingProvider><StudioRecorderProvider>{children}</StudioRecorderProvider></ClickUpLoadingProvider></EchoAIProvider>
      </body>
    </html>
  );
}
