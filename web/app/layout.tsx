export const metadata = {
  title: "Multi-AI Bridge",
  description: "Coordinate multiple AI agents on a shared task",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          [data-netlify-badge],
          #netlify-badge,
          a[href*="netlify.com"][style*="position: fixed"],
          a[href*="www.netlify.com"][style*="fixed"] {
            opacity: 0.2 !important;
            pointer-events: none !important;
            transform: scale(0.75);
            transform-origin: bottom right;
            bottom: 4px !important;
            right: 4px !important;
          }
        `}</style>
      </head>
      <body style={{ margin: 0, background: "#ffffff", color: "#111" }}>{children}</body>
    </html>
  );
}
