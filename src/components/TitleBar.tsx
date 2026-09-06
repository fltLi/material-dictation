import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, makeStyles, tokens } from "@fluentui/react-components";
import {
  ArrowLeftRegular,
  DismissRegular,
  SettingsRegular,
  SquareRegular,
  SubtractRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular,
} from "@fluentui/react-icons";
import { useState } from "react";

const useStyles = makeStyles({
  bar: {
    height: "var(--titlebar-height)",
    display: "flex",
    alignItems: "center",
    paddingLeft: "12px",
    paddingRight: "4px",
    background: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    flexShrink: 0,
    gap: "8px",
    WebkitUserSelect: "none",
    cursor: "default",
  },
  drag: {
    flex: 1,
    height: "100%",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
  },
  title: {
    fontSize: "13px",
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  icon: {
    width: "18px",
    height: "18px",
    borderRadius: "4px",
    background: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "10px",
    fontWeight: 700,
    flexShrink: 0,
  },
  winBtn: {
    minWidth: "40px",
    height: "32px",
    borderRadius: "4px",
  },
  actionBtn: {
    minWidth: "32px",
    height: "32px",
    borderRadius: "4px",
  },
  spacer: {
    width: "4px",
  },
});

interface TitleBarProps {
  inEditor: boolean;
  onBack?: () => void;
  dark: boolean;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

export function TitleBar({ inEditor, onBack, dark, onToggleTheme, onOpenSettings }: TitleBarProps) {
  const styles = useStyles();
  const [maximized, setMaximized] = useState(false);

  const win = getCurrentWindow();
  win
    .isMaximized()
    .then(setMaximized)
    .catch(() => {});

  const minimize = () => win.minimize();
  const toggleMaximize = async () => {
    await win.toggleMaximize();
    const now = await win.isMaximized();
    setMaximized(now);
  };
  const close = () => win.close();

  return (
    <div className={styles.bar}>
      <div className={styles.drag} data-tauri-drag-region>
        <div className={styles.icon}>M</div>
        <span className={styles.title}>Material Dictation</span>
        {inEditor && onBack && (
          <Button size="small" appearance="subtle" icon={<ArrowLeftRegular />} onClick={onBack}>
            返回
          </Button>
        )}
      </div>
      <Button
        className={styles.actionBtn}
        appearance="subtle"
        title={dark ? "切换到浅色模式" : "切换到深色模式"}
        aria-label={dark ? "切换到浅色模式" : "切换到深色模式"}
        icon={dark ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
        onClick={onToggleTheme}
      />
      <Button
        className={styles.actionBtn}
        appearance="subtle"
        title="设置"
        aria-label="设置"
        icon={<SettingsRegular />}
        onClick={onOpenSettings}
      />
      <span className={styles.spacer} />
      <Button
        className={styles.winBtn}
        appearance="subtle"
        icon={<SubtractRegular />}
        onClick={minimize}
        aria-label="最小化"
      />
      <Button
        className={styles.winBtn}
        appearance="subtle"
        icon={<SquareRegular />}
        onClick={toggleMaximize}
        aria-label={maximized ? "还原" : "最大化"}
      />
      <Button
        className={styles.winBtn}
        appearance="subtle"
        icon={<DismissRegular />}
        onClick={close}
        aria-label="关闭"
      />
    </div>
  );
}
