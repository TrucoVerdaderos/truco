# Truco 3 vs 3 - Contador + Ranking

Web estática para jugar al truco 3 vs 3 con:

- Marcador hasta 30.
- Equipos de 3 jugadores.
- Modalidad redonda y pica pica con botón de siguiente ronda.
- Carga individual de los pica pica.
- Mano a mano durante la partida.
- Ranking con rating inicial de 300.
- Historial de partidas del último año.
- Modo visitante y modo admin.
- Guardado en `data.json` dentro del mismo repositorio usando GitHub.

## Jugadores cargados

- Nico
- Scrava
- Gaspe
- Valen
- Rama
- Seba

## Cómo usarlo

### Modo visitante

Entrar a la URL normal de GitHub Pages:

```text
https://TU_USUARIO.github.io/NOMBRE_DEL_REPO/
```

Los visitantes solo pueden ver.

### Modo admin

Entrar agregando `?admin=1`:

```text
https://TU_USUARIO.github.io/NOMBRE_DEL_REPO/?admin=1
```

El admin puede crear partidas, sumar/restar de a 1, pasar a la siguiente ronda, cargar pica pica, finalizar partidos y guardar el ranking.

## Configuración del token admin

Para que el admin pueda guardar los cambios en `data.json`, necesitás crear un Fine-grained Personal Access Token en GitHub con permiso:

```text
Repository permissions > Contents > Read and write
```

Recomendación:

- Darle acceso solo a este repositorio.
- Ponerle vencimiento.
- No compartirlo en grupos.
- No pegarlo en el código.

La app lo guarda solo en el navegador del admin mediante `localStorage`.

## Publicar en GitHub Pages

1. Crear un repositorio, por ejemplo `truco`.
2. Subir estos archivos en la raíz del repo:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `data.json`
3. Ir a `Settings > Pages`.
4. En `Build and deployment`, elegir:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
5. Guardar.
6. Entrar a la URL publicada.

## Cómo funcionan las rondas

- En redonda, el admin suma o resta puntos de a 1.
- Cuando termina la mano, el admin toca `Siguiente ronda`.
- Hasta que un equipo llegue a 5 puntos, se sigue jugando redonda.
- Cuando un equipo llega a 5 o más, al tocar `Siguiente ronda` la próxima será pica pica.
- Después alterna pica pica / redonda.
- Cuando cualquier equipo llega a 25 o más, ya no hay más pica pica.
- En pica pica se cargan los 3 mano a mano.
- La app suma al marcador general solo la diferencia neta.
- Si empatan, no suma nada.

## Rating

Todos empiezan con 300 puntos.

La app actualiza el rating al finalizar cada partido, pero no muestra el cálculo en pantalla.

## Datos persistentes

`data.json` guarda:

- jugadores
- ranking
- partida activa
- historial del último año
- mano a mano histórico

## Notas importantes

- Si abrís la app localmente sin GitHub, puede guardar datos solo en ese navegador.
- Para que todos vean lo mismo, hay que publicarla en GitHub Pages y usar el token admin para guardar cambios.
- Los visitantes actualizan el marcador automáticamente cada 5 segundos.
- Como hay un solo admin, se evita que dos personas pisen cambios al mismo tiempo.
