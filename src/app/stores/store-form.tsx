"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function StoreForm() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setMessage("");
    setError("");

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const payload = {
      name: form.get("name"),
      baseUrl: form.get("baseUrl"),
      githubOwner: form.get("githubOwner"),
      githubRepo: form.get("githubRepo"),
      githubBranch: form.get("githubBranch"),
    };

    try {
      const response = await fetch("/api/stores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Não foi possível cadastrar a loja."
        );
      }

      setMessage(
        `Loja "${data.store.name}" cadastrada. Agora falta instalar e validar o conector.`
      );

      formElement.reset();

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Ocorreu um erro inesperado."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
    >
      <div className="mb-6">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-400">
          Nova loja
        </p>

        <h2 className="mt-2 text-2xl font-semibold">
          Cadastrar loja
        </h2>

        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Cadastre o domínio publicado da loja. Os dados do GitHub são
          opcionais, mas serão úteis para automatizarmos a instalação do
          conector depois.
        </p>
      </div>

      <div className="space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm text-zinc-300">
            Nome da loja
          </span>

          <input
            required
            name="name"
            placeholder="Ex.: Minha Loja"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition focus:border-emerald-500"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm text-zinc-300">
            URL publicada
          </span>

          <input
            required
            type="url"
            name="baseUrl"
            placeholder="https://minha-loja.vercel.app"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition focus:border-emerald-500"
          />
        </label>

        <div className="border-t border-zinc-800 pt-5">
          <p className="mb-4 text-sm font-medium text-zinc-300">
            GitHub
            <span className="ml-2 font-normal text-zinc-500">
              opcional
            </span>
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-2 block text-sm text-zinc-400">
                Usuário / organização
              </span>

              <input
                name="githubOwner"
                placeholder="andreajoa"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition focus:border-emerald-500"
              />
            </label>

            <label>
              <span className="mb-2 block text-sm text-zinc-400">
                Repositório
              </span>

              <input
                name="githubRepo"
                placeholder="minha-loja"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition focus:border-emerald-500"
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm text-zinc-400">
              Branch
            </span>

            <input
              name="githubBranch"
              defaultValue="main"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition focus:border-emerald-500"
            />
          </label>
        </div>

        {message && (
          <div className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-300">
            {message}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          disabled={loading}
          className="w-full rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Cadastrando..." : "Cadastrar loja"}
        </button>
      </div>
    </form>
  );
}
