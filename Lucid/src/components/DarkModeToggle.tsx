import { useDarkMode } from "../context/DarkModeContext";
import { Moon, Sun } from "./icons";

type Props = {
  className?: string;
};

export default function DarkModeToggle({ className = "" }: Props) {
  const { darkMode, toggleDarkMode } = useDarkMode();

  return (
    <button
      onClick={toggleDarkMode}
      className={`p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${className}`}
      aria-label="Toggle dark mode"
      type="button"
    >
      {darkMode ? (
        <Sun className="w-5 h-5 text-amber-500" />
      ) : (
        <Moon className="w-5 h-5 text-gray-700" />
      )}
    </button>
  );
}
