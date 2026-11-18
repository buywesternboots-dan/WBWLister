import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Screen from '../screen';
import { sessionSecret } from '../../lib/gate';
import { readSession } from '../../lib/session';

// This seller's screen. Anyone else goes to their own screen or to /login.
export default async function Page() {
  const jar = await cookies();
  const who = await readSession(jar.get('auth')?.value, sessionSecret());
  if (!who) redirect('/login');
  if (who.role !== 'seller') redirect('/');
  return <Screen />;
}
