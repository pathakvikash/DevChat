import HomeClient from "@/app/components/home/HomeClient";

// Signed-in "/". The middleware rewrites a signed-out "/" to /welcome (the static landing page), so this
// page needs no auth() call and is not held up behind the app skeleton in loading.tsx.
export default function Page() {
  return <HomeClient />;
}
