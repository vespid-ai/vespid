import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Vespid Foundation</h1>
      <p>Bootstrap pages for auth and organization onboarding.</p>
      <div className="card">
        <p><Link href="/auth">Go to Auth Bootstrap</Link></p>
        <p><Link href="/org">Go to Organization Bootstrap</Link></p>
      </div>
    </main>
  );
}
