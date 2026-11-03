// Lets node run the app's extensionless imports (Next resolves them; node does not).
export function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z0-9]+$/i.test(specifier))
    return nextResolve(specifier + '.js', context);
  return nextResolve(specifier, context);
}
