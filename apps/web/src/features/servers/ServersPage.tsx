import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { serversApi } from "@/services/servers.api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { getErrorMessage } from "@/services/api";
import { timeAgo } from "@/utils/format";

export function ServersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", host: "", sshPort: 22, username: "deploy",
    authType: "SSH_KEY", privateKey: "",
  });
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["servers"],
    queryFn: () => serversApi.list({ pageSize: 50 }),
  });

  const createMutation = useMutation({
    mutationFn: () => serversApi.create({
      name: form.name,
      host: form.host,
      sshPort: Number(form.sshPort),
      username: form.username,
      authType: form.authType,
      privateKey: form.privateKey || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["servers"] });
      setOpen(false);
      setForm({ name: "", host: "", sshPort: 22, username: "deploy", authType: "SSH_KEY", privateKey: "" });
      setError(null);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => serversApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers"] }),
    onError: (err) => alert(getErrorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Serveurs de déploiement</h1>
        <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> Nouveau serveur</Button>
      </div>

      {isLoading && <p>Chargement…</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.items.map((s) => (
          <Card key={s.id}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">{s.name}</h3>
                <p className="text-sm text-slate-400 font-mono mt-1">{s.host}:{s.sshPort}</p>
                <p className="text-xs text-slate-500 mt-1">user: {s.username} · auth: {s.authType}</p>
              </div>
              <button
                onClick={() => confirm(`Supprimer ${s.name} ?`) && deleteMutation.mutate(s.id)}
                className="text-slate-500 hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-slate-700">{s.status}</span>
              <span className="text-slate-500">créé {timeAgo(s.createdAt)}</span>
            </div>
          </Card>
        ))}
      </div>

      {data?.items.length === 0 && (
        <Card><p className="text-slate-400 text-center py-8">Aucun serveur enregistré.</p></Card>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-panel border border-border rounded-lg p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">Nouveau serveur</h2>
            <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="space-y-3">
              <Input placeholder="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <Input placeholder="Hôte (IP ou hostname)" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
              <div className="grid grid-cols-2 gap-3">
                <Input type="number" placeholder="Port SSH" value={form.sshPort} onChange={(e) => setForm({ ...form, sshPort: Number(e.target.value) })} />
                <Input placeholder="Utilisateur" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              <Select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value })}>
                <option value="SSH_KEY">Clé SSH</option>
              </Select>
              <textarea
                placeholder="Clé privée (PEM)"
                value={form.privateKey}
                onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
                className="w-full px-3 py-2 rounded-md bg-slate-900 border border-border text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                rows={6}
                required
              />
              {error && <div className="text-red-400 text-sm bg-red-950/50 border border-red-800 rounded p-2">{error}</div>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Annuler</Button>
                <Button type="submit" disabled={createMutation.isPending}>Créer</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}