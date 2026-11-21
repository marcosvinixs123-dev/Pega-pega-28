import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const app = document.getElementById("app");
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I para evitar confusão
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LOGO = `<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#16324f"/><circle cx="256" cy="256" r="170" fill="none" stroke="#f2c230" stroke-width="14" stroke-dasharray="30 22"/><path d="M256 150c-40 0-70 30-70 68 0 52 70 130 70 130s70-78 70-130c0-38-30-68-70-68z" fill="#e8483b"/><circle cx="256" cy="216" r="26" fill="#eef3ee"/></svg>`;

let db, canal = null, jogo = null, jogadores = [], meuId = null;

// ---------- telas ----------
function tela(html) { app.innerHTML = html; }

function telaInicial(erro = "") {
  tela(`
    <div class="logo">${LOGO}<h1>pega<span class="ponto">28</span></h1>
    <p class="suave">Esconde-esconde na vida real, com mapa e GPS. Grátis.</p></div>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}
    <div class="acoes">
      <button id="criar">Criar partida</button>
      <button id="entrar" class="sec">Entrar na partida</button>
    </div>
    <p class="aviso">Nesta versão, mantenha o app aberto e a tela ligada durante a partida.</p>`);
  document.getElementById("criar").onclick = telaCriar;
  document.getElementById("entrar").onclick = () => telaEntrar();
}

const CAMPOS = [
  ["total", "Duração da partida (min)", 30],
  ["vantagem", "Tempo para se esconder (min)", 3],
  ["ping", "Intervalo entre pings (min)", 2],
  ["raio", "Raio inicial da zona (m)", 500],
  ["encolhe_cada", "Zona diminui a cada (min)", 5],
  ["encolhe_pct", "Redução da zona (%)", 20],
  ["fora_revela", "Fora da zona: revelar após (s)", 30],
  ["fora_elimina", "Fora da zona: eliminar após (s)", 120],
  ["cacadores", "Caçadores", 1],
  ["fugitivos", "Fugitivos", 3],
];

function telaCriar(erro = "") {
  tela(`
    <div class="topo"><button class="voltar" id="voltar" aria-label="Voltar">←</button><h2>Criar partida</h2></div>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}
    <label>Seu apelido<input id="apelido" maxlength="20" autocomplete="off" placeholder="Ex.: Mano"></label>
    <fieldset><legend>Regras</legend>
      ${CAMPOS.map(([k, t, v]) => `<label>${t}<input id="c_${k}" type="number" inputmode="numeric" min="1" value="${v}"></label>`).join("")}
    </fieldset>
    <p class="aviso">A escolha do local e do círculo no mapa chega na Etapa 3.</p>
    <button id="ok">Criar e gerar código</button>`);
  document.getElementById("voltar").onclick = () => telaInicial();
  document.getElementById("ok").onclick = criarPartida;
}

function telaEntrar(erro = "", codigo = "", apelido = "") {
  tela(`
    <div class="topo"><button class="voltar" id="voltar" aria-label="Voltar">←</button><h2>Entrar na partida</h2></div>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}
    <label>Código da partida<input id="codigo" class="codigo" maxlength="6" autocomplete="off" autocapitalize="characters" value="${esc(codigo)}" placeholder="••••••"></label>
    <label>Seu apelido<input id="apelido" maxlength="20" autocomplete="off" value="${esc(apelido)}" placeholder="Ex.: Mano"></label>
    <button id="ok">Entrar</button>`);
  document.getElementById("voltar").onclick = () => telaInicial();
  document.getElementById("ok").onclick = entrarPartida;
}

function telaSala() {
  const souHost = jogo.host_id === meuId;
  tela(`
    <div class="topo"><h2>Sala de espera</h2></div>
    <div class="codigo-grande"><span class="suave">Código da partida</span><strong>${esc(jogo.code)}</strong>
      <button class="sec" id="compartilhar">Compartilhar código</button></div>
    <h2 style="font-size:1.2rem">Jogadores (${jogadores.length})</h2>
    <ul class="lista">${jogadores.map((p) => `<li class="${p.user_id === jogo.host_id ? "host" : ""}"><span>${esc(p.nickname)}${p.user_id === meuId ? " (você)" : ""}</span><span class="tag">${p.user_id === jogo.host_id ? "anfitrião" : ""}</span></li>`).join("")}</ul>
    <p class="aviso">${souHost ? "Definir equipes e iniciar a partida chegam nas Etapas 4 e 5." : "Aguardando o anfitrião. Você será avisado aqui quando a partida começar (Etapa 5)."}</p>
    <button disabled>Iniciar partida (em breve)</button>
    <button class="perigo" id="sair">Sair da sala</button>`);
  document.getElementById("sair").onclick = sairDaSala;
  document.getElementById("compartilhar").onclick = async () => {
    const texto = `Entra no pega28! Código: ${jogo.code}\n${location.origin}${location.pathname}`;
    try { navigator.share ? await navigator.share({ text: texto }) : (await navigator.clipboard.writeText(texto), alert("Copiado!")); } catch {}
  };
}

// ---------- ações ----------
const num = (id) => Math.max(1, parseInt(document.getElementById(id).value, 10) || 1);
const apelidoValido = () => document.getElementById("apelido").value.trim();

async function criarPartida() {
  const apelido = apelidoValido();
  if (!apelido) return telaCriar("Digite um apelido.");
  const settings = Object.fromEntries(CAMPOS.map(([k]) => [k, num("c_" + k)]));
  let g = null;
  for (let i = 0; i < 6 && !g; i++) {
    const code = Array.from({ length: 6 }, () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]).join("");
    const r = await db.from("games").insert({ code, settings }).select().single();
    if (!r.error) g = r.data; else if (r.error.code !== "23505") return telaCriar("Erro ao criar: " + r.error.message);
  }
  if (!g) return telaCriar("Não consegui gerar um código. Tente de novo.");
  const p = await db.from("players").insert({ game_id: g.id, nickname: apelido });
  if (p.error) return telaCriar("Erro ao entrar na sala: " + p.error.message);
  await abrirSala(g);
}

async function entrarPartida() {
  const codigo = document.getElementById("codigo").value.trim().toUpperCase();
  const apelido = apelidoValido();
  if (codigo.length !== 6) return telaEntrar("O código tem 6 caracteres.", codigo, apelido);
  if (!apelido) return telaEntrar("Digite um apelido.", codigo, apelido);
  const r = await db.from("games").select().eq("code", codigo).maybeSingle();
  if (r.error) return telaEntrar("Erro: " + r.error.message, codigo, apelido);
  if (!r.data) return telaEntrar("Código não encontrado.", codigo, apelido);
  if (r.data.status !== "lobby") return telaEntrar("Essa partida já começou.", codigo, apelido);
  const p = await db.from("players").insert({ game_id: r.data.id, nickname: apelido });
  if (p.error && p.error.code !== "23505") return telaEntrar("Erro ao entrar: " + p.error.message, codigo, apelido);
  await abrirSala(r.data);
}

async function abrirSala(g) {
  jogo = g;
  localStorage.setItem("pega28_jogo", g.id);
  await recarregarJogadores();
  if (canal) db.removeChannel(canal);
  canal = db.channel("sala-" + g.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `game_id=eq.${g.id}` }, recarregarJogadores)
    .subscribe();
}

async function recarregarJogadores() {
  const r = await db.from("players").select().eq("game_id", jogo.id).order("created_at");
  if (r.error) return;
  if (!r.data.some((p) => p.user_id === meuId)) return sairLocal();
  jogadores = r.data;
  telaSala();
}

async function sairDaSala() {
  await db.from("players").delete().eq("game_id", jogo.id).eq("user_id", meuId);
  sairLocal();
}
function sairLocal() {
  if (canal) db.removeChannel(canal);
  canal = null; jogo = null; jogadores = [];
  localStorage.removeItem("pega28_jogo");
  telaInicial();
}

// ---------- início ----------
async function iniciar() {
  if (SUPABASE_URL.startsWith("COLE_") || SUPABASE_ANON_KEY.startsWith("COLE_")) {
    return tela(`<h2>Falta configurar</h2><p class="erro">Abra o arquivo config.js e cole a URL e a chave do seu Supabase.</p>`);
  }
  db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let { data: { session } } = await db.auth.getSession();
  if (!session) {
    const r = await db.auth.signInAnonymously();
    if (r.error) return tela(`<h2>Erro de conexão</h2><p class="erro">${esc(r.error.message)}</p><p class="suave">Confira se "Allow anonymous sign-ins" está ligado no Supabase.</p>`);
    session = r.data.session;
  }
  meuId = session.user.id;
  const salvo = localStorage.getItem("pega28_jogo");
  if (salvo) {
    const r = await db.from("games").select().eq("id", salvo).maybeSingle();
    if (r.data && r.data.status === "lobby") return abrirSala(r.data);
    localStorage.removeItem("pega28_jogo");
  }
  telaInicial();
}
iniciar();
