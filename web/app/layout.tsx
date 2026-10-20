export const metadata = {
  title: "Multi-AI Bridge",
  description: "Coordinate multiple AI agents on the same task",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
