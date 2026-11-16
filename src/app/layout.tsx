export const metadata = {
  title: 'CafeOps Manager',
  description: 'Cafe operations and profit management dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
