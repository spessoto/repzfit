(function () {
  const currentScript = document.currentScript;
  if (!currentScript) return;

  const scriptUrl = new URL(currentScript.src);
  const legacyHost = "app.repz.fit";
  const canonicalOrigin = "https://app.ezpersonal.com.br";
  const platformOrigin =
    scriptUrl.hostname === legacyHost ? canonicalOrigin : scriptUrl.origin;
  const source = currentScript.getAttribute("data-source") || "landing";
  const recoveryRedirect =
    currentScript.getAttribute("data-recovery-redirect") || "";
  const normalizedRecoveryRedirect = recoveryRedirect.replace(
    "https://app.repz.fit",
    canonicalOrigin,
  );
  const width = currentScript.getAttribute("data-width") || "100%";
  const height = currentScript.getAttribute("data-height") || "860";

  const iframeUrl = new URL(`${platformOrigin}/embed/personal-signup.html`);
  iframeUrl.searchParams.set("source", source);
  iframeUrl.searchParams.set("embed_theme", "light");
  iframeUrl.searchParams.set("embed_compact", "1");
  if (normalizedRecoveryRedirect) {
    iframeUrl.searchParams.set("recover_redirect", normalizedRecoveryRedirect);
  }

  const iframe = document.createElement("iframe");
  iframe.src = iframeUrl.toString();
  iframe.width = width;
  iframe.height = height;
  iframe.style.width = width;
  iframe.style.maxWidth = "100%";
  iframe.style.border = "0";
  iframe.style.borderRadius = "16px";
  iframe.style.overflow = "hidden";
  iframe.setAttribute("loading", "lazy");
  iframe.setAttribute("title", "Cadastro de Personal EZ Personal");

  const container = document.createElement("div");
  container.style.width = "100%";
  container.style.maxWidth = "560px";
  container.appendChild(iframe);

  currentScript.parentNode.insertBefore(container, currentScript.nextSibling);
})();
