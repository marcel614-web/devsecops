import paramiko, hashlib, base64
host='127.0.0.1'; port=2222
transport=paramiko.Transport((host,port))
transport.start_client(timeout=10)
key=transport.get_remote_server_key()
print('key type:', key.get_name())
blob=key.asbytes()
digest=hashlib.sha256(blob).digest()
fp='SHA256:'+base64.b64encode(digest).decode().rstrip('=')
print('fingerprint:', fp)
transport.close()