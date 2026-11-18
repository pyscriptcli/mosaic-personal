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
      <body className="h-full w-full bg-bg-primary font-sans antialiased text-[#181D1E] overflow-hidden">
        <EchoAIProvider><ClickUpLoadingProvider><StudioRecorderProvider>{children}</StudioRecorderProvider></ClickUpLoadingProvider></EchoAIProvider>
      </body>
    </html>
  );
}
