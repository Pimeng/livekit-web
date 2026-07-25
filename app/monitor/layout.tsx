import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "导播监看台",
  description: "LiveKit 导播监看台",
};

export default function MonitorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
