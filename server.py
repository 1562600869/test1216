import sqlite3
import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

DB_NAME = 'mc_shop.db'

def init_db():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS vehicles
                 (plate TEXT PRIMARY KEY,
                  model_type TEXT NOT NULL CHECK(model_type IN ('街车','跑车','越野','巡航','复古')),
                  owner_name TEXT NOT NULL,
                  owner_phone TEXT NOT NULL,
                  displacement INTEGER NOT NULL CHECK(displacement > 0))''')
    c.execute('''CREATE TABLE IF NOT EXISTS orders
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  plate TEXT NOT NULL,
                  modify_type TEXT NOT NULL CHECK(modify_type IN ('排气','悬挂','外观','动力','电气')),
                  order_date TEXT NOT NULL,
                  cost INTEGER NOT NULL CHECK(cost >= 0),
                  status TEXT NOT NULL DEFAULT '待施工' CHECK(status IN ('待施工','施工中','已完成','已取消')),
                  FOREIGN KEY (plate) REFERENCES vehicles(plate))''')
    conn.commit()
    conn.close()

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

class MCShopHandler(BaseHTTPRequestHandler):
    def _set_headers(self, status=200, content_type='application/json'):
        self.send_response(status)
        self.send_header('Content-type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers()

    def _read_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(content_length) or '{}')

    def _json_response(self, data, status=200):
        self._set_headers(status)
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def _error_response(self, message, status=400):
        self._json_response({'error': message}, status)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        try:
            if path == '/api/vehicles':
                conn = get_db()
                rows = conn.execute('SELECT * FROM vehicles ORDER BY plate').fetchall()
                conn.close()
                self._json_response([dict(r) for r in rows])

            elif path == '/api/orders':
                conn = get_db()
                rows = conn.execute('SELECT o.*, v.model_type, v.owner_name FROM orders o JOIN vehicles v ON o.plate = v.plate ORDER BY o.id DESC').fetchall()
                conn.close()
                self._json_response([dict(r) for r in rows])

            elif path == '/api/orders/by-owner':
                owner_name = query.get('owner_name', [None])[0]
                if not owner_name:
                    self._error_response('缺少 owner_name 参数')
                    return
                conn = get_db()
                orders = conn.execute('''SELECT o.*, v.model_type FROM orders o JOIN vehicles v ON o.plate = v.plate 
                                         WHERE v.owner_name = ? ORDER BY o.order_date DESC''', (owner_name,)).fetchall()
                total = conn.execute('''SELECT COALESCE(SUM(o.cost), 0) as total FROM orders o 
                                        JOIN vehicles v ON o.plate = v.plate 
                                        WHERE v.owner_name = ? AND o.status != '已取消' ''', (owner_name,)).fetchone()
                conn.close()
                self._json_response({'orders': [dict(r) for r in orders], 'total_cost': total['total']})

            elif path == '/api/stats/monthly':
                now = datetime.now()
                month_start = now.strftime('%Y-%m-01')
                conn = get_db()
                rows = conn.execute('''SELECT modify_type, COUNT(*) as count, COALESCE(SUM(cost), 0) as total 
                                       FROM orders WHERE order_date >= ? AND status != '已取消' 
                                       GROUP BY modify_type''', (month_start,)).fetchall()
                conn.close()
                self._json_response([dict(r) for r in rows])

            elif path == '/' or path == '/index.html':
                self._serve_file('index.html', 'text/html; charset=utf-8')
            elif path == '/script.js':
                self._serve_file('script.js', 'application/javascript; charset=utf-8')
            elif path == '/style.css':
                self._serve_file('style.css', 'text/css; charset=utf-8')
            else:
                self._error_response('接口不存在', 404)
        except Exception as e:
            self._error_response(str(e), 500)

    def _serve_file(self, filename, content_type):
        try:
            with open(filename, 'rb') as f:
                self._set_headers(200, content_type)
                self.wfile.write(f.read())
        except FileNotFoundError:
            self._error_response('文件不存在', 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            data = self._read_body()

            if path == '/api/vehicles':
                plate = data.get('plate', '').strip()
                model_type = data.get('model_type', '')
                owner_name = data.get('owner_name', '').strip()
                owner_phone = data.get('owner_phone', '').strip()
                displacement = data.get('displacement')

                if not all([plate, model_type, owner_name, owner_phone, displacement]):
                    self._error_response('请填写完整信息')
                    return
                if not isinstance(displacement, int) or displacement <= 0:
                    self._error_response('排量必须是正整数')
                    return

                conn = get_db()
                try:
                    conn.execute('''INSERT INTO vehicles (plate, model_type, owner_name, owner_phone, displacement)
                                    VALUES (?, ?, ?, ?, ?)''',
                                 (plate, model_type, owner_name, owner_phone, displacement))
                    conn.commit()
                except sqlite3.IntegrityError:
                    conn.close()
                    self._error_response('该车牌已存在')
                    return
                conn.close()
                self._json_response({'message': '添加成功'}, 201)

            elif path == '/api/orders':
                plate = data.get('plate', '').strip()
                modify_type = data.get('modify_type', '')
                order_date = data.get('order_date', '')
                cost = data.get('cost')

                if not all([plate, modify_type, order_date, cost is not None]):
                    self._error_response('请填写完整信息')
                    return
                if not isinstance(cost, int) or cost < 0:
                    self._error_response('费用必须是非负整数')
                    return

                conn = get_db()
                v = conn.execute('SELECT plate FROM vehicles WHERE plate = ?', (plate,)).fetchone()
                if not v:
                    conn.close()
                    self._error_response('车辆不存在，请先添加车辆档案')
                    return

                cur = conn.execute('''INSERT INTO orders (plate, modify_type, order_date, cost, status)
                                      VALUES (?, ?, ?, ?, '待施工')''',
                                 (plate, modify_type, order_date, cost))
                conn.commit()
                order_id = cur.lastrowid
                conn.close()
                self._json_response({'id': order_id, 'message': '工单创建成功'}, 201)

            else:
                self._error_response('接口不存在', 404)
        except Exception as e:
            self._error_response(str(e), 500)

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            data = self._read_body()

            if path.startswith('/api/orders/'):
                order_id = path.split('/')[-1]
                if not order_id.isdigit():
                    self._error_response('无效的工单ID')
                    return

                conn = get_db()
                order = conn.execute('SELECT * FROM orders WHERE id = ?', (int(order_id),)).fetchone()
                if not order:
                    conn.close()
                    self._error_response('工单不存在')
                    return

                if order['status'] == '已取消':
                    conn.close()
                    self._error_response('已取消工单不能修改')
                    return

                action = data.get('action', '')
                if action == 'advance':
                    status_flow = {'待施工': '施工中', '施工中': '已完成'}
                    if order['status'] not in status_flow:
                        conn.close()
                        self._error_response('当前状态无法推进')
                        return
                    new_status = status_flow[order['status']]
                    conn.execute('UPDATE orders SET status = ? WHERE id = ?', (new_status, int(order_id)))
                    conn.commit()
                    conn.close()
                    self._json_response({'message': f'状态已更新为{new_status}'})

                elif action == 'cancel':
                    if order['status'] != '待施工':
                        conn.close()
                        self._error_response('只有待施工状态才能取消')
                        return
                    conn.execute('UPDATE orders SET status = ? WHERE id = ?', ('已取消', int(order_id)))
                    conn.commit()
                    conn.close()
                    self._json_response({'message': '工单已取消'})

                elif action == 'update':
                    plate = data.get('plate', order['plate']).strip()
                    modify_type = data.get('modify_type', order['modify_type'])
                    order_date = data.get('order_date', order['order_date'])
                    cost = data.get('cost', order['cost'])

                    if not isinstance(cost, int) or cost < 0:
                        conn.close()
                        self._error_response('费用必须是非负整数')
                        return

                    v = conn.execute('SELECT plate FROM vehicles WHERE plate = ?', (plate,)).fetchone()
                    if not v:
                        conn.close()
                        self._error_response('车辆不存在')
                        return

                    conn.execute('''UPDATE orders SET plate = ?, modify_type = ?, order_date = ?, cost = ? 
                                    WHERE id = ?''',
                                 (plate, modify_type, order_date, cost, int(order_id)))
                    conn.commit()
                    conn.close()
                    self._json_response({'message': '工单已更新'})

                else:
                    conn.close()
                    self._error_response('无效的操作')

            elif path.startswith('/api/vehicles/'):
                plate = path.split('/')[-1]
                if not plate:
                    self._error_response('无效的车牌')
                    return

                conn = get_db()
                v = conn.execute('SELECT * FROM vehicles WHERE plate = ?', (plate,)).fetchone()
                if not v:
                    conn.close()
                    self._error_response('车辆不存在')
                    return

                model_type = data.get('model_type', v['model_type'])
                owner_name = data.get('owner_name', v['owner_name']).strip()
                owner_phone = data.get('owner_phone', v['owner_phone']).strip()
                displacement = data.get('displacement', v['displacement'])

                if not isinstance(displacement, int) or displacement <= 0:
                    conn.close()
                    self._error_response('排量必须是正整数')
                    return

                conn.execute('''UPDATE vehicles SET model_type = ?, owner_name = ?, owner_phone = ?, displacement = ?
                                WHERE plate = ?''',
                             (model_type, owner_name, owner_phone, displacement, plate))
                conn.commit()
                conn.close()
                self._json_response({'message': '车辆信息已更新'})

            else:
                self._error_response('接口不存在', 404)
        except Exception as e:
            self._error_response(str(e), 500)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            if path.startswith('/api/orders/'):
                order_id = path.split('/')[-1]
                if not order_id.isdigit():
                    self._error_response('无效的工单ID')
                    return

                conn = get_db()
                conn.execute('DELETE FROM orders WHERE id = ?', (int(order_id),))
                conn.commit()
                conn.close()
                self._json_response({'message': '工单已删除'})

            elif path.startswith('/api/vehicles/'):
                plate = urllib.parse.unquote(path.split('/')[-1])
                if not plate:
                    self._error_response('无效的车牌')
                    return

                conn = get_db()
                has_orders = conn.execute('SELECT COUNT(*) as cnt FROM orders WHERE plate = ?', (plate,)).fetchone()
                if has_orders['cnt'] > 0:
                    conn.close()
                    self._error_response('该车辆存在关联工单，无法删除')
                    return
                conn.execute('DELETE FROM vehicles WHERE plate = ?', (plate,))
                conn.commit()
                conn.close()
                self._json_response({'message': '车辆已删除'})

            else:
                self._error_response('接口不存在', 404)
        except Exception as e:
            self._error_response(str(e), 500)

def run():
    init_db()
    server = HTTPServer(('127.0.0.1', 5193), MCShopHandler)
    print('摩托车改装俱乐部管理系统已启动: http://localhost:5193')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n服务器已停止')
        server.server_close()

if __name__ == '__main__':
    run()