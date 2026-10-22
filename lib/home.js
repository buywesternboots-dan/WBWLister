// The only app screen after sign-in. Admin gets every tool here; a seller gets the same screen, only their items.
export const HOME = '/';
export const TOOLS = ['sellers', 'import', 'review', 'export', 'sync', 'settings'];
export const toolsFor = role => role === 'admin' ? TOOLS : role === 'seller' ? ['import', 'review', 'export', 'sync'] : [];
