"use client";

// @json-render/react's published dist strips its "use client" directives
// (a packaging bug — only the sourcemaps still reference it), so importing
// its providers directly into a Server Component (layout.tsx) throws
// "createContext only works in Client Components". Wrapping them here in
// our own "use client" file gives Next.js the boundary it needs.
import {
  StateProvider,
  VisibilityProvider,
  ActionProvider,
  ValidationProvider,
} from "@json-render/react";

export default function GenerativeUiProviders({ children }: { children: React.ReactNode }) {
  return (
    <StateProvider>
      <VisibilityProvider>
        <ActionProvider handlers={{}}>
          <ValidationProvider>{children}</ValidationProvider>
        </ActionProvider>
      </VisibilityProvider>
    </StateProvider>
  );
}
