import { useEffect, useState, useRef } from "react";

const CELL_SIZE = 30;
const url = `${location.protocol}//${location.hostname}:5000`;

type Point = [number, number];

const Grid = () => {
  const [gridSize, setGridSize] = useState(35); // Para coincidir con backend size
  const [walls, setWalls] = useState<Point[]>([]);
  const [rfids, setRfids] = useState<Point[]>([]);
  const [tracks, setTracks] = useState<Point[]>([]);

  const [start, setStart] = useState<Point | null>(null);
  const [goal, setGoal] = useState<Point | null>(null);
  const [path, setPath] = useState<Point[]>([]);
  const [visited, setVisited] = useState<Point[]>([]);
  const [finished, setFinished] = useState(false);

  const [selectionMode, setSelectionMode] = useState<"start" | "goal" | null>(null);
  const [running, setRunning] = useState(false);

  const [showInstructions, setShowInstructions] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Función para cargar el mapa inicial desde backend
  const fetchMap = async () => {
    try {
      const res = await fetch(`${url}/init`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar mapa");

      setGridSize(data.size);
      setWalls(data.walls);
      setRfids(data.rfids);
      setTracks(data.tracks);
      setStart(null);
      setGoal(null);
      setPath([]);
      setVisited([]);
      setFinished(false);
      setRunning(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } catch (err) {
      alert("Error cargando mapa: " + err);
    }
  };

  // Inicializar planner en backend con start y goal
  const initPlanner = async (start: Point, goal: Point) => {
    try {
      const res = await fetch(`${url}/init-planner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, goal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error inicializando planner");
      // Obtener primer path
      await fetchPath();
      setFinished(false);
    } catch (err) {
      alert("Error inicializando planner: " + err);
      setStart(null);
      setGoal(null);
    }
  };

  // Obtener path y visited actualizados desde backend (/map)
  const fetchPath = async () => {
    try {
      const res = await fetch(`${url}/map`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error obteniendo path");
      setPath(data.path);
      setVisited(data.visited);
    } catch (err) {
      alert("Error obteniendo path: " + err);
      setRunning(false);
    }
  };

  // Avanzar un paso en backend (/step)
  const step = async () => {
    try {
      const res = await fetch(`${url}/step`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error haciendo step");
      setStart(data.start);
      setPath(data.path);
      setVisited(data.visited);
      setFinished(data.finished);
      if (data.finished) {
        setRunning(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch (err) {
      alert("Error en step: " + err);
      setRunning(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  };

  // Toggle ejecutar o parar el planificador
  const toggleRunning = () => {
    if (running) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setRunning(false);
    } else {
      if (!start || !goal) {
        alert("Define start y goal antes de iniciar");
        return;
      }
      setRunning(true);
      intervalRef.current = setInterval(step, 400);
    }
  };

  // Resetear todo, también backend
  const resetPlanner = async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRunning(false);
    setPath([]);
    setVisited([]);
    setFinished(false);
    setStart(null);
    setGoal(null);
    setWalls([]);
    setRfids([]);
    setTracks([]);
    try {
      await fetch(`${url}/reset`, { method: "POST" });
      await fetchMap();
    } catch (err) {
      alert("Error al resetear: " + err);
    }
  };

  // Manejar click en celda: dependiendo del modo seleccionamos start, goal o toggle pared
  const handleCellClick = async (x: number, y: number) => {
    if (selectionMode === "start") {
      if (walls.some(([wx, wy]) => wx === x && wy === y)) return;
      setStart([x, y]);
      setSelectionMode(null);
      setPath([]);
      setVisited([]);
      setFinished(false);
      if (goal) await initPlanner([x, y], goal);
    } else if (selectionMode === "goal") {
      if (walls.some(([wx, wy]) => wx === x && wy === y)) return;
      setGoal([x, y]);
      setSelectionMode(null);
      setPath([]);
      setVisited([]);
      setFinished(false);
      if (start) await initPlanner(start, [x, y]);
    } else {
      // Toggle pared y avisar backend (/update-map)
      const cell = [x, y] as Point;
      let newWalls: Point[];
      const wallExists = walls.some(([wx, wy]) => wx === x && wy === y);
      if (wallExists) {
        newWalls = walls.filter(([wx, wy]) => wx !== x || wy !== y);
      } else {
        newWalls = [...walls, cell];
      }
      setWalls(newWalls);

      try {
        await fetch(`${url}/update-map`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cell }),
        });
        // Recalcular path solo si planner inicializado y start/goal definidos
        if (start && goal) await fetchPath();
      } catch (err) {
        alert("Error actualizando mapa: " + err);
      }
    }
  };

  // Render de celda con clases para start, goal, path, walls, visited
  const renderCell = (x: number, y: number) => {
    const isWall = walls.some(([wx, wy]) => wx === x && wy === y);
    const isStart = start && start[0] === x && start[1] === y;
    const isGoal = goal && goal[0] === x && goal[1] === y;
    const isPath = path.some(([px, py]) => px === x && py === y);
    const isVisited = visited.some(([vx, vy]) => vx === x && vy === y);

    let className = "size-3 rounded-md cursor-pointer border border-gray-300 transition-all ";
    if (isWall) className += "bg-zinc-800";
    else if (isStart) className += "bg-green-400";
    else if (isGoal) className += "bg-red-400";
    else if (isPath) className += "bg-sky-400";
    else if (isVisited) className += "bg-pink-200";
    else className += "bg-gray-100 hover:bg-gray-300";

    return (
      <div
        key={`${x}-${y}`}
        className={className}
        onClick={() => handleCellClick(x, y)}
        style={{ width: CELL_SIZE, height: CELL_SIZE }}
      />
    );
  };

  useEffect(() => {
    fetchMap();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Cerrar modal con ESC
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowInstructions(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="flex flex-col p-5 justify-center items-center gap-3">
      <div className="flex gap-3 mb-2 w-full">
        <button
          onClick={() => setSelectionMode("start")}
          className={`px-4 py-2 rounded-md font-medium transition ${
            selectionMode === "start" ? "bg-green-600 text-white" : "bg-green-400 hover:bg-green-500"
          }`}
        >
          Set Start
        </button>
        <button
          onClick={() => setSelectionMode("goal")}
          className={`px-4 py-2 rounded-md font-medium transition ${
            selectionMode === "goal" ? "bg-red-600 text-white" : "bg-red-400 hover:bg-red-500"
          }`}
        >
          Set Goal
        </button>
        <button
          onClick={() => setSelectionMode(null)}
          disabled={!selectionMode}
          className="px-4 py-2 rounded-md font-medium bg-gray-300 disabled:opacity-50 hover:bg-gray-400 transition"
        >
          Cancel
        </button>

        <button
          onClick={() => setShowInstructions(true)}
          className="ml-auto px-4 py-2 rounded-md font-medium bg-yellow-400 hover:bg-yellow-500 transition"
        >
          Instrucciones
        </button>
      </div>

      <div className="flex justify-center w-full gap-4 mb-4">
        <button
          onClick={toggleRunning}
          disabled={finished || !start || !goal}
          className="px-4 py-2 font-medium rounded-md cursor-pointer bg-blue-400 hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-200 disabled:text-gray-500 transition-all"
        >
          {running ? "Stop" : "Start"}
        </button>
        <button
          className="px-4 py-2 font-medium rounded-md cursor-pointer bg-gray-200 hover:bg-gray-100 transition-all"
          onClick={resetPlanner}
        >
          RESET
        </button>
      </div>

      <div
        className="max-w-[85dvw] border-[1px] border-gray-300 rounded-md shadow-lg"
        style={{ overflow: "auto", maxHeight: "90vh" }}
      >
        <div
          className="p-3 max-w-full overflow-auto grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${gridSize}, ${CELL_SIZE}px)`,
            gridTemplateRows: `repeat(${gridSize}, ${CELL_SIZE}px)`,
          }}
        >
          {Array.from({ length: gridSize }).flatMap((_, y) =>
            Array.from({ length: gridSize }).map((_, x) => renderCell(x, y))
          )}
        </div>
      </div>

      {/* Modal instrucciones */}
      {showInstructions && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50"
          onClick={() => setShowInstructions(false)}
          aria-modal="true"
          role="dialog"
        >
          <div
            className="bg-white rounded-lg max-w-md p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4">Instrucciones de uso</h2>
            <ol className="list-decimal list-inside space-y-2 text-gray-800">
              <li>Selecciona un punto de <strong>Start</strong> y un punto de <strong>Goal</strong> haciendo clic en sus respectivos botones y luego en el grid.</li>
              <li>Pulsa el botón <strong>Start</strong> para comenzar a recorrer el camino.</li>
              <li>Durante el recorrido, puedes modificar las paredes haciendo clic en cualquier casilla para añadir o quitar una pared.</li>
              <li>El planner recalculará automáticamente la mejor ruta según los cambios que hagas.</li>
            </ol>
            <button
              onClick={() => setShowInstructions(false)}
              className="mt-6 px-4 py-2 bg-yellow-400 hover:bg-yellow-500 rounded-md font-semibold"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Grid;
