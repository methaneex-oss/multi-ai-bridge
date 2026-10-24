export const metadata = {
  title: "Multi-AI Bridge",
  description: "Coordinate multiple AI agents on a shared task",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#ffffff", color: "#111" }}>{children}</body>
    </html>
  );
}
