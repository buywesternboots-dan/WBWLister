import BugReporter from '../components/bug-reporter/BugReporter';

export const metadata = { title: 'BootLister', robots: { index: false, follow: false } };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}<BugReporter /></body></html>;
}
