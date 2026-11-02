import paramiko
host="127.0.0.1"; port=2222; user="deploy"
key_path="C:/Users/Lenovo/.ssh/deploy_vm"
remote_dir="/home/deploy/apps/cmvuln9r2001in8jnlaud3exp/production"
project_name="devsecops-cmvuln9r2001in8jnlaud3exp-production"
client=paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
key=paramiko.Ed25519Key.from_private_key_file(key_path)
client.connect(host, port=port, username=user, pkey=key, timeout=20)
# cleanup all containers for this project and networks
for cmd in [
    "docker rm -f $(docker ps -aq --filter name=cmvuln9r2001in8jnlaud3exp-production) 2>/dev/null || true",
    "docker rm -f $(docker ps -aq --filter name=production-) 2>/dev/null || true",
    "docker network rm devsecops-cmvuln9r2001in8jnlaud3exp-production-devsecops 2>/dev/null || true",
    f"cd {remote_dir} && docker compose -p {project_name} up -d --remove-orphans",
]:
    stdin,stdout,stderr=client.exec_command(cmd, timeout=180)
    print("CMD:", cmd)
    out=stdout.read().decode(); err=stderr.read().decode()
    print(out)
    if err.strip(): print("ERR:", err)
    print("EXIT:", stdout.channel.recv_exit_status())
    print("="*40)
# health check
stdin,stdout,stderr=client.exec_command("curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8080/ 2>/dev/null || echo FAILED", timeout=30)
print("HTTP:", stdout.read().decode().strip())
client.close()
