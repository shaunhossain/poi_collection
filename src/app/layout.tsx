import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'POI Collection | Street View POI & Map Dashboard',
  description: 'Interactive MapLibre dashboard visualizing street view detected business POIs and tracks in Bangladesh',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased h-screen w-screen overflow-hidden">
        {children}
      </body>
    </html>
  );
}
