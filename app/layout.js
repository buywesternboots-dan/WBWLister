export const metadata = { title: 'BootLister', robots: { index: false, follow: false } };
export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
