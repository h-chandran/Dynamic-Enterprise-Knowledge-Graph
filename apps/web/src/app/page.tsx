import { appEnv } from "@/lib/env";

const features = ["graph", "extraction", "analytics", "visualization"] as const;

export default function HomePage() {
  return (
    <main className="container">
      <h1>{appEnv.NEXT_PUBLIC_APP_NAME}</h1>
      <p>
        Monorepo frontend scaffold. Business logic and product workflows are intentionally
        unimplemented.
      </p>
      <section>
        <h2>Feature Modules</h2>
        <ul>
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
