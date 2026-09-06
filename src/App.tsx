import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  FluentProvider,
  Spinner,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import { openUrl } from "@tauri-apps/plugin-opener";
import { TitleBar } from "./components/TitleBar";
import { SettingsModal } from "./components/SettingsModal";
import { api } from "./services/backend";
import { useEditor } from "./stores/editor";
import { useSettings } from "./stores/settings";
import type { OpenProject, UpdateInfo } from "./types";
import { EditorView } from "./views/EditorView";
import { StartView } from "./views/StartView";
import "./App.css";

// 主窗口内容。主窗口启动时 hidden，就绪后显示并关闭启动小窗。
export default function MainApp() {
  const settings = useSettings((s) => s.settings);
  const loaded = useSettings((s) => s.loaded);
  const load = useSettings((s) => s.load);
  const setTheme = useSettings((s) => s.setTheme);

  const [project, setProject] = useState<OpenProject | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [loadingModel, setLoadingModel] = useState(false);
  const [exitAction, setExitAction] = useState<"back" | "close" | null>(null);
  const allowCloseRef = useRef(false);
  const autoLoadRef = useRef(false);

  // 主窗口就绪：显示主窗口并关闭启动画面（消除加载白屏），参考 webgal-lsp。
  useEffect(() => {
    const win = getCurrentWindow();
    void win.show();
    void WebviewWindow.getByLabel("splashscreen").then((w) => w?.close());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loaded) return;
    api
      .checkUpdate()
      .then((info) => {
        if (info.hasUpdate) setUpdateInfo(info);
      })
      .catch(() => {});
  }, [loaded]);

  // 启动时自动加载上次使用的模型。注意：dev 模式下 React StrictMode 会双重执行
  // effect，若不拦挡会创建两个 whisper 上下文（后一个顶替前一个），进而触发
  // whisper 编码器的状态问题（failed to encode）。用 ref 保证只加载一次。
  useEffect(() => {
    if (!loaded || !settings?.lastModelId || autoLoadRef.current) return;
    autoLoadRef.current = true;
    setLoadingModel(true);
    api
      .loadModel(settings.lastModelId, () => {})
      .catch(() => {})
      .finally(() => setLoadingModel(false));
  }, [loaded, settings?.lastModelId]);

  // 关闭窗口时拦截未导出的更改。
  useEffect(() => {
    if (!project) return;
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onCloseRequested((event) => {
        if (allowCloseRef.current) return;
        if (useEditor.getState().dirty) {
          event.preventDefault();
          setExitAction("close");
        }
      })
      .then((f) => {
        unlisten = f;
      });
    return () => {
      if (unlisten) unlisten();
    };
  }, [project]);

  const tryBack = () => {
    if (useEditor.getState().dirty) setExitAction("back");
    else setProject(null);
  };

  const doExit = () => {
    const action = exitAction;
    setExitAction(null);
    if (action === "back") {
      setProject(null);
    } else if (action === "close") {
      // 用户已确认退出：用 destroy() 强制关闭，绕过 onCloseRequested 拦截，
      // 避免再次触发“未导出更改”提示而无法真正退出。
      allowCloseRef.current = true;
      void getCurrentWindow().destroy();
    }
  };

  const theme = settings?.theme === "dark" ? webDarkTheme : webLightTheme;

  const toggleTheme = () => {
    void setTheme(settings?.theme === "dark" ? "light" : "dark");
  };

  return (
    <FluentProvider theme={theme}>
      <div className="app-shell">
        <TitleBar
          inEditor={project !== null}
          onBack={tryBack}
          dark={theme === webDarkTheme}
          onToggleTheme={toggleTheme}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <div className="app-content">
          {project ? (
            <EditorView project={project} />
          ) : (
            <StartView onOpen={setProject} onOpenSettings={() => setSettingsOpen(true)} />
          )}
        </div>

        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        <Dialog open={loadingModel}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>正在加载模型</DialogTitle>
              <DialogContent>
                <Spinner label="正在加载上次使用的模型…" />
              </DialogContent>
              <DialogActions>
                <Button appearance="secondary" onClick={() => setLoadingModel(false)}>
                  关闭
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>

        <Dialog open={updateInfo !== null}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>发现新版本</DialogTitle>
              <DialogContent>
                当前版本 {updateInfo?.currentVersion}，最新版本 {updateInfo?.latestVersion}。
              </DialogContent>
              <DialogActions>
                <Button appearance="secondary" onClick={() => setUpdateInfo(null)}>
                  稍后
                </Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    if (updateInfo?.releaseUrl) void openUrl(updateInfo.releaseUrl);
                    setUpdateInfo(null);
                  }}
                >
                  前往 Releases
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>

        <Dialog open={exitAction !== null}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>未导出的更改</DialogTitle>
              <DialogContent>
                当前项目有未导出的更改，确定要{exitAction === "close" ? "退出" : "返回开始页"}吗？
              </DialogContent>
              <DialogActions>
                <Button appearance="secondary" onClick={() => setExitAction(null)}>
                  取消
                </Button>
                <Button appearance="primary" onClick={doExit}>
                  确定
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      </div>
    </FluentProvider>
  );
}
