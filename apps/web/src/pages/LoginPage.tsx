import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../lib/api";
import { Icon } from "../components/Icon";
import { BrandLogo, BrandTagline } from "../components/BrandLogo";
import { useBrandContext } from "../brand/BrandContext";

const inputCls =
  "rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 font-body text-body-md text-on-surface outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/30";

const HIGHLIGHTS = [
  { icon: "how_to_vote", label: "Reconheça seus pares" },
  { icon: "workspace_premium", label: "Conquiste selos" },
  { icon: "diversity_3", label: "Celebre as lendas do time" },
];

export function LoginPage() {
  const { login } = useAuth();
  const { branding, scheme } = useBrandContext();
  // Marca d'água do painel: a arte da EMPRESA. Estava cravada na do produto, o
  // que punha a logo do Legends de fundo na tela de entrada de todo cliente.
  const marca =
    branding.logos[scheme].mark ??
    branding.logos[scheme === "dark" ? "light" : "dark"].mark;
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, remember);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao entrar");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col lg:grid lg:grid-cols-2">
      {/* Esquerda: formulário */}
      <div className="flex flex-1 items-center justify-center p-8 lg:min-h-screen">
        <div className="w-full max-w-sm">
          <div className="mb-xl">
            <BrandLogo
              wideFallback="/illustration/horizontal_logo_trim.png"
              className="h-16 w-auto object-contain"
            />
            <BrandTagline className="mt-1 text-body-md text-on-surface-variant" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-md">
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              E-mail
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              Senha
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className={`${inputCls} w-full pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-on-surface-variant transition-colors hover:text-on-surface focus:outline-none focus-visible:text-primary"
                >
                  <Icon
                    name={showPassword ? "visibility_off" : "visibility"}
                    className="text-[24px]"
                  />
                </button>
              </div>
            </label>
            <label className="flex cursor-pointer items-center gap-sm font-label text-label-sm text-on-surface-variant">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="h-4 w-4 rounded border-outline-variant/60 bg-surface-container-highest text-primary accent-primary focus:ring-2 focus:ring-primary/30"
              />
              Manter conectado
            </label>
            {error && (
              <p
                role="alert"
                className="flex items-center gap-sm text-body-sm text-error"
              >
                <Icon name="error" className="text-[16px]" />
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="mt-sm flex items-center justify-center gap-sm rounded-md bg-primary py-2.5 font-label text-label-md font-bold text-on-primary transition-all hover:bg-primary-container hover:text-on-primary-container active:scale-[0.98] disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {submitting ? "Entrando…" : "Entrar"}
              {!submitting && (
                <Icon name="arrow_forward" className="text-[18px]" />
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Direita (desktop): painel visual de marca — oculto no mobile (só o formulário) */}
      <aside className="relative hidden overflow-hidden bg-surface-container-lowest lg:block">
        {/* grid técnico */}
        <div
          className="absolute inset-0"
          style={{
            // Grade na cor da empresa: o verde do produto estava cravado aqui.
            backgroundImage:
              "linear-gradient(rgb(var(--brand-primary, 82 251 162) / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--brand-primary, 82 251 162) / 0.06) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        {/* logo como marca d'água de fundo */}
        {/* Empresa sem símbolo cadastrado cai na arte do produto. */}
        <img
          src={marca ?? "/illustration/logo.png"}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 w-[140%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain opacity-10"
        />
        {/* brilhos */}
        <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-24 left-0 h-72 w-72 rounded-full bg-primary-container/10 blur-3xl" />

        <div className="relative z-10 flex h-full flex-col items-start justify-center gap-md px-xl py-xl lg:gap-xl lg:py-0">
          <div>
            <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">
              Feedback entre pares
            </p>
            <h2 className="mt-2 max-w-md font-headline text-headline-md text-on-surface lg:text-headline-xl">
              Quem constrói merece virar lenda.
            </h2>
            <p className="mt-md max-w-md text-body-md text-on-surface-variant lg:text-body-lg">
              Feedback entre pares para valorizar quem impulsiona nossos
              sistemas todos os dias.
            </p>
          </div>

          <ul className="flex flex-col gap-sm lg:gap-md">
            {HIGHLIGHTS.map((item) => (
              <li
                key={item.icon}
                className="flex items-center gap-md text-on-surface"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-highest text-primary">
                  <Icon name={item.icon} className="text-[20px]" />
                </span>
                <span className="font-body text-body-md">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
