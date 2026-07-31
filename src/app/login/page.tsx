import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { MessageSquare } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { callbackUrl } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--background)] text-[var(--foreground)] p-6">
      <div className="w-full max-w-sm glass-card rounded-[var(--glass-radius-xl)] p-8 space-y-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-14 rounded-full glass-surface flex items-center justify-center">
            <MessageSquare size={28} className="text-zinc-300" />
          </div>
          <h1 className="text-xl font-bold">Sign in to DevChat</h1>
          <p className="text-sm text-zinc-500">
            Use your Google account to continue.
          </p>
        </div>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl || "/" });
          }}
        >
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-[var(--glass-radius-md)] glass-button-primary text-white text-sm font-medium transition"
          >
            <GoogleIcon />
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v2.98h3.86c2.26-2.09 3.59-5.17 3.59-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.92l-3.86-2.98c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.07C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.19 7.19 0 0 1 4.9 12c0-.79.14-1.56.37-2.29V6.64H1.28A11.94 11.94 0 0 0 0 12c0 1.93.46 3.76 1.28 5.36l3.99-3.07Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.28 6.64l3.99 3.07C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}
