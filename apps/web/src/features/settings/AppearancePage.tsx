import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useThemeStore } from "@/stores/themeStore";

export function AppearancePage() {
  const { theme, set } = useThemeStore();
  return (
    <div>
      <PageHeader title="Apparence" description="Thème de l'interface" />
      <Card>
        <CardContent className="flex gap-4 py-4">
          <Button variant={theme === "light" ? "primary" : "ghost"} onClick={() => set("light")}>
            Clair
          </Button>
          <Button variant={theme === "dark" ? "primary" : "ghost"} onClick={() => set("dark")}>
            Sombre
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}