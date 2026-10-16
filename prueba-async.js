function esperar() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("Espera terminada");
    }, 2000);
  });
}

console.log("Antes de esperar");
const resultado = await esperar();
console.log(resultado);
console.log("Después de esperar");