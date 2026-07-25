import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LiveKit Token Generator",
  description: "在浏览器本地生成 LiveKit Access Token",
};

export default function TokenGeneratorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}