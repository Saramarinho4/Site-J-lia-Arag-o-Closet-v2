/* =====================================================================
   Júlia Aragão Closet · servidor de pagamento (Cloudflare Worker)
   Feito por Astera ✦

   O que ele faz:
   - POST /checkout  confere preços e estoque, cria o pagamento no Mercado Pago
                     e devolve o link (init_point) pro site redirecionar.
   - POST /webhook   o Mercado Pago avisa aqui; se o pagamento foi aprovado,
                     baixa o estoque e marca o pedido como pago.
   - GET  /estoque   o site lê o estoque atual pra mostrar "Esgotado".
   - GET  /pedidos?chave=...   lista de pedidos pra loja (protegida por ADMIN_KEY).
   - GET  /pedido?ref=...      status de um pedido (o site usa na volta do MP).

   Configuração no painel do Cloudflare (Workers > este worker > Settings):
   - Variables and Secrets:
       MP_ACCESS_TOKEN  (Secret)  Access Token de produção do Mercado Pago
       ADMIN_KEY        (Secret)  uma senha qualquer pra ver /pedidos
       SITE_URL         (Text)    https://juliaaragaocloset.com.br
   - Bindings > KV namespace:  nome da variável  LOJA
   ===================================================================== */

/* Catálogo: nome, preço cheio, preço no Pix e estoque INICIAL.
   Se mudar preço no site, mude aqui também. Estoque real fica no KV
   (o inicial só é usado na primeira vez, ou em /estoque/reset). */
const CATALOGO = {"body": {"name": "Body Poliamida", "price": 69.99, "pix": 66.49, "byColor": true, "stock": {"Terracota": {"Único": 3}, "Bege": {"Único": 3}, "Preto": {"Único": 3}}}, "moletinho": {"name": "Conjunto Moletinho", "price": 169.99, "pix": 161.49, "byColor": false, "stock": {"G": 1}}, "alfaiataria": {"name": "Conjunto Alfaiataria", "price": 149.99, "pix": 142.49, "byColor": false, "stock": {"G": 1}}, "regatas": {"name": "Regatas Basiquinhas", "price": 39.99, "pix": 37.99, "byColor": false, "stock": {"Único": 8}}, "longoVermelho": {"name": "Vestido longo vermelho na malha poliamida", "price": 129.99, "pix": 123.49, "byColor": false, "stock": {"Único": 1}}, "longoAmarelo": {"name": "Vestido longo amarelo na alfaiataria", "price": 139.99, "pix": 132.99, "byColor": false, "stock": {"Único": 1}}, "longoAzul": {"name": "Vestido longo azul claro no crepe duna", "price": 89.99, "pix": 85.49, "byColor": false, "stock": {"Único": 1}}, "crepeVermelho": {"name": "Vestido no crepe duna vermelho", "price": 94.99, "pix": 90.24, "byColor": false, "stock": {"GG": 1}}, "marrantVermelho": {"name": "Conjunto no Marrant vermelho", "price": 194.99, "pix": 185.24, "byColor": false, "stock": {"P": 1}}, "vestLongoOff": {"name": "Vestido longo off-white na alfaiataria", "price": 149.99, "pix": 142.49, "byColor": false, "stock": {"M": 1}}, "vestFluidoMarrom": {"name": "Vestido longo fluido na alfaiataria marrom", "price": 149.99, "pix": 142.49, "byColor": false, "stock": {"G": 1}}, "bodyPaete": {"name": "Body com paetê", "price": 39.99, "pix": 37.99, "byColor": false, "stock": {"Único": 1}}, "conjPaete": {"name": "Conjunto no paetê", "price": 79.99, "pix": 75.99, "byColor": false, "stock": {"Único": 1}}, "vestViscosePreto": {"name": "Vestido no viscolinho preto", "price": 109.99, "pix": 104.49, "byColor": false, "stock": {"G": 1}}, "chemiseViscose": {"name": "Chemise na viscose preta", "price": 149.99, "pix": 142.49, "byColor": false, "stock": {"GG": 1}}, "vestViscolycra": {"name": "Vestido na viscolycra verde", "price": 129.99, "pix": 123.49, "byColor": false, "stock": {"M": 1}}, "vestTrespassado": {"name": "Vestido no viscolinho trespassado azul", "price": 159.99, "pix": 151.99, "byColor": false, "stock": {"GG": 1}}, "tubinhoViscolinho": {"name": "Tubinho no viscolinho preto", "price": 119.99, "pix": 113.99, "byColor": false, "stock": {"G": 1}}, "vestViscolycraPreto": {"name": "Vestido longo na viscolycra preto", "price": 129.99, "pix": 123.49, "byColor": false, "stock": {"G": 1}}, "tubinhoAmarelo": {"name": "Tubinho na alfaiataria amarelo", "price": 79.99, "pix": 75.99, "byColor": false, "stock": {"G": 1}}, "chemiseSedinha": {"name": "Chemise na sedinha estampada", "price": 139.99, "pix": 132.99, "byColor": false, "stock": {"GG": 1}}, "vestCanelado": {"name": "Vestido no canelado 3D", "price": 59.99, "pix": 56.99, "byColor": false, "stock": {"Único": 1}}, "tubinhoTule": {"name": "Tubinho com detalhe de tule", "price": 69.99, "pix": 66.49, "byColor": false, "stock": {"Único": 1}}, "conjMagenta": {"name": "Conjunto alfaiataria magenta (cropped + short)", "price": 129.99, "pix": 123.49, "byColor": false, "stock": {"M": 1}}, "conjViscoseVerde": {"name": "Conjunto na viscose verde", "price": 59.99, "pix": 56.99, "byColor": false, "stock": {"P": 1}}, "conjColeteBermuda": {"name": "Conjunto colete com bermuda bordado", "price": 149.99, "pix": 142.49, "byColor": false, "stock": {"P": 1}}, "conjColetePantalona": {"name": "Conjunto colete e pantalona alfaiataria", "price": 159.99, "pix": 151.99, "byColor": false, "stock": {"P": 1}}, "conjSaiaOffWhite": {"name": "Conjunto alfaiataria cropped e saia off-white", "price": 119.99, "pix": 113.99, "byColor": false, "stock": {"M": 1}}, "conjCroppedPantalona": {"name": "Conjunto cropped e pantalona no crepe", "price": 194.99, "pix": 185.24, "byColor": false, "stock": {"P": 1}}, "conjBermudaCinza": {"name": "Conjunto alfaiataria cropped e bermuda cinza", "price": 119.99, "pix": 113.99, "byColor": false, "stock": {"M": 1}}, "bodyPromo": {"name": "Body", "price": 34.99, "pix": 33.24, "byColor": false, "stock": {"Único": 1}}, "bodyRendaLonga": {"name": "Body com rendas (manga longa)", "price": 69.99, "pix": 66.49, "byColor": false, "stock": {"Único": 1}}, "bodyRendaCurta": {"name": "Body com rendas (manga curta)", "price": 69.99, "pix": 66.49, "byColor": false, "stock": {"Único": 1}}, "bodyRendaV": {"name": "Body com rendas (decote V)", "price": 69.99, "pix": 66.49, "byColor": false, "stock": {"Único": 1}}, "camisaListradaM": {"name": "Camisa na viscose listrada", "price": 94.99, "pix": 90.24, "byColor": false, "stock": {"M": 1}}, "camisaListradaP": {"name": "Camisa na viscose listrada", "price": 94.99, "pix": 90.24, "byColor": false, "stock": {"P": 1}}, "blusaSedinhaM": {"name": "Blusa sedinha com malha", "price": 49.99, "pix": 47.49, "byColor": false, "stock": {"M": 1}}, "blusaSedinhaGG": {"name": "Blusa sedinha com malha", "price": 49.99, "pix": 47.49, "byColor": false, "stock": {"GG": 1}}, "bataPoa": {"name": "Bata tomara que caia de poá", "price": 74.99, "pix": 71.24, "byColor": false, "stock": {"Único": 1}}, "blusaAssimetrica": {"name": "Blusa assimétrica na sedinha", "price": 74.99, "pix": 71.24, "byColor": false, "stock": {"Único": 1}}, "tshirt": {"name": "T-shirt", "price": 49.99, "pix": 47.49, "byColor": false, "stock": {"P": 1}}, "blusaMarrom": {"name": "Blusa marrom na poliamida", "price": 59.99, "pix": 56.99, "byColor": false, "stock": {"Único": 1}}, "blusaPink": {"name": "Blusa alça no Marrant pink", "price": 49.99, "pix": 47.49, "byColor": false, "stock": {"M": 1}}, "shortOffWhite": {"name": "Short off-white", "price": 59.99, "pix": 56.99, "byColor": false, "stock": {"P": 1}}, "shortMarrom": {"name": "Short marrom", "price": 59.99, "pix": 56.99, "byColor": false, "stock": {"P": 1}}, "calcaWide": {"name": "Calça jeans wide leg", "price": 168, "pix": 159.6, "byColor": false, "stock": {"40": 1, "42": 1}}, "calcaLinho": {"name": "Calça no linho", "price": 179.99, "pix": 170.99, "byColor": true, "stock": {"Off-white": {"M": 1}, "Preta": {"M": 1}}}, "calcaBege": {"name": "Calça bege", "price": 99.99, "pix": 94.99, "byColor": false, "stock": {"P": 1}}, "regataBoreal": {"name": "Regata no canelado boreal", "price": 64.99, "pix": 61.74, "byColor": true, "stock": {"Bege": {"G": 1}, "Cinza": {"G": 1}}}, "macacaoCargo": {"name": "Macacão cargo no Marrant", "price": 199.99, "pix": 189.99, "byColor": false, "stock": {"G": 1}}, "macaquinhoPreto": {"name": "Macaquinho na sedinha preto", "price": 69.99, "pix": 66.49, "byColor": false, "stock": {"Único": 1}}};

const FRETES = { pac: { name: "PAC", price: 22.9 }, sedex: { name: "SEDEX", price: 38.5 } };

const json = (data, status = 200, origin = "*") =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });

const r2 = (v) => Math.round(v * 100) / 100;

async function getEstoque(env) {
  const s = await env.LOJA.get("estoque", "json");
  if (s) return s;
  const ini = {};
  for (const id in CATALOGO) ini[id] = CATALOGO[id].stock;
  await env.LOJA.put("estoque", JSON.stringify(ini));
  return ini;
}

function mapa(estoque, id, cor) {
  const p = CATALOGO[id];
  const m = estoque[id];
  if (!m) return null;
  return p.byColor ? m[cor] : m;
}

async function mp(env, path, opts = {}) {
  const res = await fetch("https://api.mercadopago.com" + path, {
    ...opts,
    headers: { Authorization: "Bearer " + env.MP_ACCESS_TOKEN, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("MP " + res.status + ": " + JSON.stringify(data).slice(0, 300));
  return data;
}

async function checkout(req, env) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.itens) || !body.itens.length) return json({ erro: "Sacola vazia." }, 400);
  const modo = body.pagamento === "pix" ? "pix" : "cartao";
  const frete = FRETES[body.frete];
  if (!frete) return json({ erro: "Escolha o frete." }, 400);
  const c = body.cliente || {};
  if (!c.nome || !/^\S+@\S+\.\S+$/.test(c.email || "")) return json({ erro: "Confira nome e e-mail." }, 400);

  const estoque = await getEstoque(env);
  const itensMP = [];
  const linhas = [];
  let subtotal = 0;
  for (const l of body.itens) {
    const p = CATALOGO[l.id];
    const qtd = Math.max(1, parseInt(l.qtd, 10) || 1);
    if (!p) return json({ erro: "Peça não encontrada." }, 400);
    const m = mapa(estoque, l.id, l.cor);
    if (!m || !(l.tam in m)) return json({ erro: "Tamanho indisponível: " + p.name }, 400);
    if (m[l.tam] < qtd) return json({ erro: "Ops, " + p.name + " acabou de esgotar nesse tamanho.", esgotado: l.id }, 409);
    const unit = modo === "pix" ? p.pix : p.price;
    subtotal += unit * qtd;
    const variante = (l.tam === "Único" ? "Tamanho único" : "Tamanho " + l.tam) + (l.cor ? " · " + l.cor : "");
    itensMP.push({ id: l.id, title: p.name + " (" + variante + ")", quantity: qtd, unit_price: r2(unit), currency_id: "BRL" });
    linhas.push({ id: l.id, tam: l.tam, cor: l.cor || null, qtd, nome: p.name, variante, unit: r2(unit) });
  }
  itensMP.push({ id: "frete-" + body.frete, title: "Frete " + frete.name, quantity: 1, unit_price: frete.price, currency_id: "BRL" });

  const ref = "JAC-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const site = (env.SITE_URL || "https://juliaaragaocloset.com.br").replace(/\/$/, "");
  const self = new URL(req.url).origin;
  const fone = (c.whatsapp || "").replace(/\D/g, "");

  const pref = {
    items: itensMP,
    external_reference: ref,
    statement_descriptor: "JULIAARAGAO",
    payer: {
      name: c.nome,
      email: c.email,
      phone: fone.length >= 10 ? { area_code: fone.slice(0, 2), number: fone.slice(2) } : undefined,
      address: body.endereco ? { zip_code: (body.endereco.cep || "").replace(/\D/g, ""), street_name: body.endereco.rua, street_number: String(body.endereco.numero || "") } : undefined,
    },
    payment_methods:
      modo === "pix"
        ? { excluded_payment_types: [{ id: "credit_card" }, { id: "debit_card" }, { id: "ticket" }, { id: "atm" }, { id: "prepaid_card" }], installments: 1 }
        : { excluded_payment_types: [{ id: "bank_transfer" }, { id: "ticket" }, { id: "atm" }], installments: 2 },
    back_urls: {
      success: site + "/?pedido=" + ref,
      pending: site + "/?pedido=" + ref,
      failure: site + "/?pedido=" + ref + "&falhou=1",
    },
    auto_return: "approved",
    notification_url: self + "/webhook",
    expires: true,
    expiration_date_to: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    metadata: { ref },
  };

  let data;
  try {
    data = await mp(env, "/checkout/preferences", { method: "POST", body: JSON.stringify(pref) });
  } catch (e) {
    return json({ erro: "Não consegui abrir o pagamento agora. Tente de novo em instantes." , detalhe: String(e.message || e) }, 502);
  }

  const pedido = {
    ref,
    criado: new Date().toISOString(),
    status: "aguardando",
    pagamento: modo,
    cliente: { nome: c.nome, email: c.email, whatsapp: c.whatsapp || "" },
    endereco: body.endereco || null,
    frete: { tipo: frete.name, valor: frete.price },
    itens: linhas,
    subtotal: r2(subtotal),
    total: r2(subtotal + frete.price),
    preference: data.id,
  };
  await env.LOJA.put("pedido:" + ref, JSON.stringify(pedido), { expirationTtl: 60 * 60 * 24 * 365 });
  return json({ ref, link: data.init_point, total: pedido.total });
}

async function webhook(req, env) {
  const url = new URL(req.url);
  let id = url.searchParams.get("data.id") || url.searchParams.get("id");
  let tipo = url.searchParams.get("type") || url.searchParams.get("topic");
  try {
    const b = await req.json();
    id = (b.data && b.data.id) || id;
    tipo = b.type || b.topic || tipo;
  } catch (e) {}
  if (!id || (tipo && tipo !== "payment")) return json({ ok: true });

  let pag;
  try { pag = await mp(env, "/v1/payments/" + id); } catch (e) { return json({ ok: false }, 500); }
  const ref = pag.external_reference;
  if (!ref) return json({ ok: true });
  const pedido = await env.LOJA.get("pedido:" + ref, "json");
  if (!pedido) return json({ ok: true });

  pedido.pagamento_id = pag.id;
  pedido.pagamento_status = pag.status;
  pedido.metodo = pag.payment_method_id;
  pedido.parcelas = pag.installments;

  if (pag.status === "approved" && pedido.status !== "pago") {
    const estoque = await getEstoque(env);
    for (const l of pedido.itens) {
      const m = mapa(estoque, l.id, l.cor);
      if (m && l.tam in m) m[l.tam] = Math.max(0, m[l.tam] - l.qtd);
    }
    await env.LOJA.put("estoque", JSON.stringify(estoque));
    pedido.status = "pago";
    pedido.pago_em = new Date().toISOString();
    await env.LOJA.put("pago:" + pedido.criado + ":" + ref, ref, { expirationTtl: 60 * 60 * 24 * 365 });
  } else if (pedido.status !== "pago") {
    pedido.status = pag.status === "rejected" || pag.status === "cancelled" ? "recusado" : "aguardando";
  }
  await env.LOJA.put("pedido:" + ref, JSON.stringify(pedido), { expirationTtl: 60 * 60 * 24 * 365 });
  return json({ ok: true });
}

const fmt = (v) => "R$ " + Number(v).toFixed(2).replace(".", ",");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function pedidos(req, env) {
  const url = new URL(req.url);
  if (!env.ADMIN_KEY || url.searchParams.get("chave") !== env.ADMIN_KEY)
    return new Response("Acesso negado", { status: 401 });
  const lista = await env.LOJA.list({ prefix: "pago:" });
  const refs = lista.keys.map((k) => k.name.split(":").pop()).reverse().slice(0, 100);
  const ps = (await Promise.all(refs.map((r) => env.LOJA.get("pedido:" + r, "json")))).filter(Boolean);
  const cards = ps.map((p) => {
    const e = p.endereco || {};
    const fone = (p.cliente.whatsapp || "").replace(/\D/g, "");
    return `<article><header><b>${esc(p.ref)}</b><span>${new Date(p.pago_em || p.criado).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span></header>
      <p><b>${esc(p.cliente.nome)}</b><br>${esc(p.cliente.email)}<br>${fone ? `<a href="https://wa.me/55${fone}">${esc(p.cliente.whatsapp)}</a>` : ""}</p>
      <p>${esc(e.rua)}, ${esc(e.numero)}${e.complemento ? " · " + esc(e.complemento) : ""}<br>${esc(e.bairro)} · ${esc(e.cidade)}/${esc(e.uf)}<br>CEP ${esc(e.cep)}</p>
      <ul>${p.itens.map((l) => `<li>${l.qtd}x ${esc(l.nome)} · ${esc(l.variante)} · ${fmt(l.unit * l.qtd)}</li>`).join("")}</ul>
      <p>Frete ${esc(p.frete.tipo)} ${fmt(p.frete.valor)} · <b>Total ${fmt(p.total)}</b> · ${p.pagamento === "pix" ? "Pix" : "Cartão" + (p.parcelas ? " " + p.parcelas + "x" : "")}</p></article>`;
  }).join("") || "<p>Nenhum pedido pago ainda.</p>";
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pedidos · Júlia Aragão Closet</title>
  <style>body{font-family:system-ui,sans-serif;background:#faf3ea;color:#3b2418;margin:0;padding:20px;max-width:720px;margin:auto}h1{font-size:22px}article{background:#fff;border-radius:14px;padding:14px 16px;margin:12px 0;border:1px solid #ecdcc8}header{display:flex;justify-content:space-between;color:#ee6a12}ul{padding-left:18px}a{color:#ee6a12}</style></head>
  <body><h1>Pedidos pagos</h1>${cards}</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return json({});
    try {
      if (url.pathname === "/checkout" && req.method === "POST") return await checkout(req, env);
      if (url.pathname === "/webhook") return await webhook(req, env);
      if (url.pathname === "/estoque") return json(await getEstoque(env));
      if (url.pathname === "/estoque/reset") {
        if (!env.ADMIN_KEY || url.searchParams.get("chave") !== env.ADMIN_KEY) return json({ erro: "negado" }, 401);
        await env.LOJA.delete("estoque");
        return json(await getEstoque(env));
      }
      if (url.pathname === "/pedido") {
        const p = await env.LOJA.get("pedido:" + url.searchParams.get("ref"), "json");
        return p ? json({ ref: p.ref, status: p.status }) : json({ erro: "não encontrado" }, 404);
      }
      if (url.pathname === "/pedidos") return await pedidos(req, env);
      return json({ ok: true, loja: "Júlia Aragão Closet" });
    } catch (e) {
      return json({ erro: "Erro no servidor." }, 500);
    }
  },
};
