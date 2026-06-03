# Voltwise — próximos passos (só falta o Supabase)

> **Estado em 2026-06-02:** está tudo pronto e testado **exceto a base de dados Supabase**, que
> só tu podes tratar (é a tua conta). Quando isso estiver feito, um único comando põe a app a
> funcionar de ponta a ponta. Este projeto vive agora em `C:\PROJECTS\pg_smartenergy`
> (fora do OneDrive — o OneDrive fazia o `next dev` rebentar).

---

## ⚠️ Importante: trabalha a partir de `C:\PROJECTS\pg_smartenergy`

O repo foi copiado do OneDrive para `C:\PROJECTS\pg_smartenergy`. **Usa esta pasta**, não a do
OneDrive. Porquê: o OneDrive transforma a cache `.next` em ficheiros-fantasma na nuvem e o
servidor de desenvolvimento do Next.js crasha no arranque (`EINVAL readlink`). Fora do OneDrive,
arranca limpo (testado: `✓ Ready in 5.7s`).

O original no OneDrive fica intacto. Quando confirmares que a cópia está boa, podes apagá-lo.

---

## A TUA parte (5 minutos) — pôr o Supabase vivo

A base de dados do `.env.local` (`idcbbjvnxyzxiwdbcjuq`) **já não existe** — confirmado: o
endereço nem sequer resolve. O Supabase **pausa projetos grátis** ao fim de ~1 semana sem uso, e
acaba por os apagar. Por isso:

1. Vai a **https://supabase.com/dashboard** e entra na tua conta.
2. **Se o projeto aparecer como "Paused"** → clica em **Restore** / **Resume**. Em 1-2 minutos volta.
   **Se não aparecer** (foi apagado) → cria um **New project** (região Europa, ex.: `eu-west`).
3. Copia as credenciais para `.env.local` (na pasta `C:\PROJECTS\pg_smartenergy`):
   - **`DATABASE_URL`** → Project Settings → Database → Connection string → separador
     **"Transaction pooler"** (porta **6543**). Tem este aspeto:
     `postgres://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`
   - **`NEXT_PUBLIC_SUPABASE_URL`** → Project Settings → API → Project URL
   - **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** → Project Settings → API → anon/public key
   - **`SUPABASE_SERVICE_ROLE_KEY`** → Project Settings → API → service_role key
4. (Magic-link de login) Em Authentication → confirma que o email está ativo. Para testar
   localmente, podes ter de adicionar `http://localhost:3000` em Authentication → URL Configuration.

> Se preferires criar projeto novo mas reusar os teus dados, não é preciso nada — o passo
> seguinte cria as tabelas todas de raiz.

---

## A MINHA parte (automática) — um comando faz o resto

Assim que o `.env.local` tiver o Supabase vivo, corre (na pasta `C:\PROJECTS\pg_smartenergy`):

```bash
node scripts/setup-after-supabase.mjs
```

Este script (idempotente — podes correr quantas vezes quiseres) faz:

1. **Liga-se ao Supabase** e confirma que está vivo (falha com mensagem clara se não estiver).
2. **Aplica as migrações 0001 → 0005** por ordem (cria todas as tabelas, incl. a nova
   `user_appliances` que o planeador precisa). São idempotentes.
3. **Verifica o catálogo de tarifas** e confirma que PT e ES têm uma tarifa indexada por defeito
   (necessária para o onboarding levar ao `/plan`).
4. **Ingere os preços OMIE** de hoje + amanhã (com fallback Energy-Charts), para o `/plan` ter
   uma curva para mostrar.
5. **Diz-te o que fazer a seguir.**

Depois disso:

```bash
npm run dev
```

E abre **http://localhost:3000** → login → onboarding (país → carro elétrico 40 kWh, 22h-07h) →
aterras no **/plan** com a melhor janela de carregamento de amanhã, em euros.

---

## O que já foi feito e testado hoje (2026-06-02)

Tudo isto está commitável e verde (**296/296 testes**, typecheck, build):

### Correções de pricing (a app já dá números honestos)
- **Tarifa fixa já não leva TAR/IEC/IVA a dobrar** — uma fixa cota preço all-in; antes inflava
  até 2,47×. Agora o preço fixo é devolvido tal e qual, igual a toda a hora do dia.
- **A auditoria já soma a TAR horária** (indexadas PT) — antes omitia o maior componente da
  fatura e sobrestimava poupanças ~1,6×.
- **IVA de Espanha corrigido** nos seeds (0.21 → 0.10).
- Testes novos a provar cada correção com euros calculados à mão.

### Correção do OMIE (a ingestão de preços voltou a funcionar)
- **URL novo**: o endereço antigo do OMIE dava 404 sempre. Agora usa o endpoint atual
  (`omie.es/es/file-download?...`).
- **Quarto-horário**: o OMIE passou de 24 preços/dia (horário) para **96 (de 15 em 15 min)** em
  2026. O parser foi atualizado para detetar e **agregar para média horária** — o resto da app
  não muda. Validado contra dados reais de 2026.
- O mesmo fix foi aplicado ao `scripts/backfill-prices.mjs` (que tem fallback Energy-Charts).
- Instalado o `dotenv` que faltava (os scripts dependiam dele).

### Ambiente
- Repo copiado para `C:\PROJECTS\pg_smartenergy` (fora do OneDrive). `next dev` arranca limpo lá.
- Sem Supabase, a app **degrada com elegância**: `/` e `/market` dão 200, `/plan` e `/onboarding`
  redirecionam para login (em vez de rebentar). Nenhum erro 500.

---

## O que falta DEPOIS do smoke test (não bloqueia o teste com o condutor TVDE)

Pendências menores que o relatório do workflow identificou, para uma próxima ronda:
- **Ciclo TAR fixo em 'simples'** no planeador/alertas (`plan/page.tsx`, `daily-runner.ts`) — um
  cliente PT bi/tri-horário recebe €/kWh com desvio de ~0,02-0,03. A direção da janela mantém-se
  certa; só os valores absolutos desviam. Falta o perfil persistir o ciclo do cliente.
- **TAR de Espanha** ainda é stub (PT tem valores reais ERSE 2026). Magnitudes ES aproximadas.
- Uns achados de robustez de severidade baixa/média nos alertas (ver relatório do workflow).
- **Granularidade quarto-horária** no produto (em vez de agregar para hora) — seria mais fiel ao
  mercado atual, mas é uma mudança grande (schema + queries + planeador).
