import './globals.css';

export const metadata = {
  title: 'TMAIL Super Admin',
  description: 'Multi-tenant SaaS control panel for TMAIL monorepo'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
