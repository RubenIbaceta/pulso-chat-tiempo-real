import { WebSocket } from "ws";

const cliente = new WebSocket("ws://localhost:8080");

function esperarConexion() {
  return new Promise((resolve, reject) => {
    cliente.once("open", () => {
      resolve("Conexión lista");
    });

    cliente.once("error", (error) => {
      reject(error);
    });
  });
}

try {
  const resultado = await esperarConexion();
  console.log(resultado);
  cliente.close();
} catch (error) {
  console.log("No se pudo conectar");
}
console.log("Prueba terminada");