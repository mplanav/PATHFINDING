import heapq
import json
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

directions = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)]

def heuristic(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1])

def read_map_json(filename):
    with open(filename, "r") as f:
        data = json.load(f)
    walls = set(map(tuple, data["walls"]))
    rfids_local = set(map(tuple, data.get("rfids", [])))
    tracks_local = set(map(tuple, data.get("tracks", [])))
    size = data.get("size", 20)
    return walls, rfids_local, tracks_local, size

def init_grid(size):
    grid = {}
    for x in range(size):
        for y in range(size):
            neighbors = []
            for dx, dy in directions:
                nx, ny = x + dx, y + dy
                if 0 <= nx < size and 0 <= ny < size:
                    neighbors.append((nx, ny))
            grid[(x, y)] = neighbors
    return grid

class DStarLite:
    def __init__(self, start, goal, walls, size):
        self.start = start
        self.goal = goal
        self.size = size
        self.km = 0
        self.grid = init_grid(size)
        self.g = {}
        self.rhs = {}
        self.U = []
        self.walls = walls
        self.visited = set()

        for node in self.grid:
            self.g[node] = float('inf')
            self.rhs[node] = float('inf')
        self.rhs[goal] = 0
        heapq.heappush(self.U, (self.calculate_key(goal), goal))

    def calculate_key(self, s):
        return (min(self.g[s], self.rhs[s]) + heuristic(self.start, s) + self.km, min(self.g[s], self.rhs[s]))

    def update_vertex(self, u):
        if u != self.goal:
            self.rhs[u] = min(
                [self.g[succ] + self.cost(u, succ) for succ in self.grid[u] if succ not in self.walls]
            )
        self.U = [(k, n) for (k, n) in self.U if n != u]
        heapq.heapify(self.U)
        if self.g[u] != self.rhs[u]:
            heapq.heappush(self.U, (self.calculate_key(u), u))

    def cost(self, a, b):
        if b in self.walls:
            return float('inf')
        return 1.4 if abs(a[0] - b[0]) == 1 and abs(a[1] - b[1]) == 1 else 1

    def compute_shortest_path(self):
        while self.U and (self.U[0][0] < self.calculate_key(self.start) or self.rhs[self.start] != self.g[self.start]):
            k_old, u = heapq.heappop(self.U)
            k_new = self.calculate_key(u)
            if k_old < k_new:
                heapq.heappush(self.U, (k_new, u))
            elif self.g[u] > self.rhs[u]:
                self.g[u] = self.rhs[u]
                for pred in self.grid[u]:
                    if pred not in self.walls:
                        self.update_vertex(pred)
            else:
                self.g[u] = float('inf')
                for pred in self.grid[u] + [u]:
                    if pred not in self.walls:
                        self.update_vertex(pred)

    def get_path(self):
        path = [self.start]
        current = self.start
        while current != self.goal:
            neighbors = [n for n in self.grid[current] if n not in self.walls]
            if not neighbors:
                return path
            next_node = min(neighbors, key=lambda n: self.g.get(n, float('inf')) + self.cost(current, n))
            if self.g.get(next_node, float('inf')) == float('inf') or next_node in path:
                break
            current = next_node
            path.append(current)
        return path

    def move_start(self, path):
        if len(path) > 1:
            self.start = path[1]
            self.visited.add(self.start)
            return self.start
        return None

# Variables globales
planner = None
walls = set()
rfids = set()
tracks = set()
start = None
goal = None
size = 35

@app.route("/init", methods=["POST"])
def init_map():
    global walls, rfids, tracks, size, planner, start, goal
    try:
        walls, rfids, tracks, size = read_map_json("mapa.json")
        planner = None
        start = None
        goal = None
        return jsonify({
            "message": "Mapa cargado",
            "size": size,
            "walls": list(walls),
            "rfids": list(rfids),
            "tracks": list(tracks),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/init-planner", methods=["POST"])
def init_planner():
    global planner, start, goal, walls, size

    data = request.get_json()
    start_point = tuple(data.get("start"))
    goal_point = tuple(data.get("goal"))

    if start_point in walls or goal_point in walls:
        return jsonify({"error": "Start o goal están en paredes"}), 400

    if not (0 <= start_point[0] < size and 0 <= start_point[1] < size):
        return jsonify({"error": "Start fuera de rango"}), 400
    if not (0 <= goal_point[0] < size and 0 <= goal_point[1] < size):
        return jsonify({"error": "Goal fuera de rango"}), 400

    start = start_point
    goal = goal_point
    planner = DStarLite(start, goal, walls, size)
    planner.compute_shortest_path()

    return jsonify({
        "message": "Planner inicializado",
        "start": start,
        "goal": goal
    })

@app.route("/map", methods=["GET"])
def get_map():
    global planner, walls, rfids, tracks, size, goal
    if not planner:
        return jsonify({"error": "Planner no inicializado"}), 400
    path = planner.get_path()
    return jsonify({
        "size": size,
        "walls": list(walls),
        "rfids": list(rfids),
        "tracks": list(tracks),
        "start": planner.start,
        "goal": goal,
        "path": path,
        "visited": list(planner.visited)
    })

@app.route("/update-map", methods=["POST"])
def update_map():
    global planner, walls
    if not planner:
        return jsonify({"error": "Planner no inicializado"}), 400

    data = request.get_json()
    cell = tuple(data.get("cell"))

    old_walls = set(walls)
    if cell in walls:
        walls.remove(cell)
    else:
        walls.add(cell)

    changed_cells = old_walls.symmetric_difference(walls)
    planner.km += heuristic(planner.start, planner.start)
    planner.walls = walls

    for cell in changed_cells:
        planner.g[cell] = float('inf')
        planner.rhs[cell] = float('inf')
        planner.update_vertex(cell)
        for neighbor in planner.grid[cell]:
            planner.update_vertex(neighbor)

    planner.compute_shortest_path()

    return jsonify({"message": "Mapa actualizado"})

@app.route("/update-start", methods=["POST"])
def update_start():
    global planner, start
    if not planner:
        return jsonify({"error": "Planner no inicializado"}), 400

    data = request.get_json()
    point = tuple(data.get("point"))

    if point in walls or not (0 <= point[0] < size and 0 <= point[1] < size):
        return jsonify({"error": "Posición inválida para start"}), 400

    start = point
    planner.start = point
    planner.km += heuristic(planner.start, point)
    planner.compute_shortest_path()

    return jsonify({"message": "Start actualizado", "start": point})

@app.route("/update-goal", methods=["POST"])
def update_goal():
    global planner, goal
    if not planner:
        return jsonify({"error": "Planner no inicializado"}), 400

    data = request.get_json()
    point = tuple(data.get("point"))

    if point in walls or not (0 <= point[0] < size and 0 <= point[1] < size):
        return jsonify({"error": "Posición inválida para goal"}), 400

    goal = point
    planner.goal = point
    planner.rhs = {node: float('inf') for node in planner.grid}
    planner.rhs[goal] = 0
    planner.U = []
    heapq.heappush(planner.U, (planner.calculate_key(goal), goal))
    planner.km += heuristic(planner.start, planner.start)
    planner.compute_shortest_path()

    return jsonify({"message": "Goal actualizado", "goal": point})

@app.route("/step", methods=["POST"])
def step():
    global planner, goal
    if not planner:
        return jsonify({"error": "Planner no inicializado"}), 400

    path = planner.get_path()
    next_pos = planner.move_start(path)

    if next_pos is None or next_pos == goal:
        return jsonify({
            "finished": True,
            "start": planner.start,
            "path": path,
            "visited": list(planner.visited)
        })

    planner.km += heuristic(planner.start, next_pos)
    planner.start = next_pos
    planner.compute_shortest_path()

    return jsonify({
        "start": planner.start,
        "path": planner.get_path(),
        "visited": list(planner.visited),
        "finished": False
    })

@app.route("/reset", methods=["POST"])
def reset():
    global planner, start, goal
    planner = None
    start = None
    goal = None
    return jsonify({"message": "Planner reseteado"})

if __name__ == "__main__":
    app.run(debug=True)
