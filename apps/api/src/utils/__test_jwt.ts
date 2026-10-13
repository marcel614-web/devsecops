// apps/api/src/utils/__test_jwt.ts
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "./jwt";

const access = signAccessToken({ sub: "user_123", role: "DEVELOPER" });
const refresh = signRefreshToken({ sub: "user_123", jti: "tok_1" });

console.log("Access token :", access.slice(0, 40) + "...");
console.log("Refresh token:", refresh.slice(0, 40) + "...");

const decodedAccess = verifyAccessToken(access);
console.log("Access décodé :", decodedAccess);

const decodedRefresh = verifyRefreshToken(refresh);
console.log("Refresh décodé :", decodedRefresh);

// Test négatif 1 : falsification
try {
  verifyAccessToken(access.slice(0, -3) + "xxx");
  console.log("ERREUR : le token falsifié a été accepté !");
} catch {
  console.log("OK : token falsifié rejeté");
}

// Test négatif 2 : mauvais type
try {
  verifyAccessToken(refresh);
  console.log("ERREUR : un refresh token a été accepté comme access !");
} catch {
  console.log("OK : refresh token refusé comme access");
}