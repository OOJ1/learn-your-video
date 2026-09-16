import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { LandingPage } from "./components/LandingPage";

// 首次进入项目时展示一次「产品介绍 · 滚动叙事页」，之后不再展示。
// 想强制查看 / 跳过：访问 ?landing=1 / ?landing=0
const SEEN_KEY = "sb_landing_seen_v1";

function Root() {
  const [showLanding, setShowLanding] = useState<boolean>(() => {
    try {
      const forced = new URLSearchParams(window.location.search).get("landing");
      if (forced === "1") return true;
      if (forced === "0") return false;
      return !localStorage.getItem(SEEN_KEY);
    } catch {
      return true;
    }
  });
  // 是否由「介绍一下自己」按钮打开：仅影响右上角按钮文案
  const [viaButton, setViaButton] = useState(false);

  const enterApp = (configure = false) => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* 隐私模式等无法写入时忽略即可 */
    }
    setViaButton(false);
    setShowLanding(false);
    // 介绍页「去配置」：进入应用后直接打开设置中心
    if (configure) window.dispatchEvent(new CustomEvent("sb:open-settings"));
  };

  // 介绍页以覆盖层呈现（.ld-root 已是 fixed 全屏），App 保持挂载：
  // 从「介绍一下自己」进去再回来时，已选文档、问答历史都不会丢。
  return (
    <>
      <App
        onShowIntro={() => {
          setViaButton(true);
          setShowLanding(true);
        }}
      />
      {showLanding && (
        <LandingPage
          onEnter={enterApp}
          onConfigure={() => enterApp(true)}
          enterLabel={viaButton ? "返回应用 →" : "跳过 →"}
        />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
