import { useState } from "react";
import { projectsApi } from "@/services/projects.api";
import { getErrorMessage } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

interface Props { open: boolean; onClose: () => void; onCreated: () => void; }

export function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState({
    name: "", description: "", repoFullName: "", repoId: "",
    defaultBranch: "main", technology: "NODEJS",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await projectsApi.create({
        name: form.name,
        description: form.description || null,
        repoFullName: form.repoFullName,
        repoId: form.repoId,
        defaultBranch: form.defaultBranch,
        technology: form.technology as "NODEJS" | "PHP" | "PYTHON" | "UNKNOWN",
      });
      onCreated();
      setForm({ name: "", description: "", repoFullName: "", repoId: "", defaultBranch: "main", technology: "NODEJS" });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-panel border border-border rounded-lg p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">Nouveau projet</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Nom</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm mb-1">Description</label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm mb-1">Repo (owner/repo ou local:chemin)</label>
            <Input value={form.repoFullName} onChange={(e) => setForm({ ...form, repoFullName: e.target.value })} placeholder="user/repo" required />
          </div>
          <div>
            <label className="block text-sm mb-1">Repo ID</label>
            <Input value={form.repoId} onChange={(e) => setForm({ ...form, repoId: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Branche par défaut</label>
              <Input value={form.defaultBranch} onChange={(e) => setForm({ ...form, defaultBranch: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm mb-1">Technologie</label>
              <Select value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value })}>
                <option value="NODEJS">Node.js</option>
                <option value="PHP">PHP</option>
                <option value="PYTHON">Python</option>
                <option value="UNKNOWN">Inconnu</option>
              </Select>
            </div>
          </div>

          {error && <div className="text-red-400 text-sm bg-red-950/50 border border-red-800 rounded p-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={loading}>{loading ? "Création…" : "Créer"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}