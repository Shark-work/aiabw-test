import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "艾比世界 - 领养你的 AI 虚拟宠物",
  description:
    "领养一只专属 AI 虚拟宠物艾比，通过陪伴式聊天解锁功能、获取 AI 工具推荐。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-zinc-50">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
