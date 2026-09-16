from flask import Flask, request, jsonify, render_template, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash

from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///study_reminder.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# ---------------- MODELS ----------------

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    study_goal_per_day = db.Column(db.Integer, default=60)  # minutes
    streak_count = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Reminder(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    subject = db.Column(db.String(100), nullable=False)
    date_time = db.Column(db.DateTime, nullable=False)
    repeat_type = db.Column(db.String(20), default='none')  # none/daily/weekly
    priority = db.Column(db.String(20), default='medium')   # low/medium/high
    is_completed = db.Column(db.Boolean, default=False)
    notes = db.Column(db.Text, default='')
    reminder_type = db.Column(db.String(20), default='study')  # 'study' or 'exam'
    notified = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'subject': self.subject,
            'date_time': self.date_time.isoformat(),
            'repeat_type': self.repeat_type,
            'priority': self.priority,
            'is_completed': self.is_completed,
            'notes': self.notes,
            'reminder_type': self.reminder_type,
            'notified': self.notified,
        }


class Timetable(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    day = db.Column(db.Integer, nullable=False)      # 0=Monday ... 6=Sunday
    start_time = db.Column(db.String(5), nullable=False)   # 'HH:MM'
    end_time = db.Column(db.String(5), nullable=False)
    subject = db.Column(db.String(100), nullable=False)
    last_notified_date = db.Column(db.String(10), default='')  # 'YYYY-MM-DD'

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'day': self.day,
            'start': self.start_time,
            'end': self.end_time,
            'subject': self.subject,
            'last_notified_date': self.last_notified_date
        }


class BreakCycle(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    label = db.Column(db.String(100), default='Break')
    study_min = db.Column(db.Integer, default=50)
    break_min = db.Column(db.Integer, default=10)
    phase = db.Column(db.String(10), default='study')   # 'study' or 'break'
    phase_end_at = db.Column(db.DateTime, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'label': self.label,
            'studyMin': self.study_min,
            'breakMin': self.break_min,
            'phase': self.phase,
            'phaseEndAt': self.phase_end_at.isoformat()
        }


class StudyLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    reminder_id = db.Column(db.Integer, db.ForeignKey('reminder.id'))
    subject = db.Column(db.String(100))
    duration = db.Column(db.Integer)  # minutes
    date = db.Column(db.DateTime, default=datetime.utcnow)


# ---------------- USER ROUTES ----------------

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    name = data.get('name')
    email = data.get('email')
    password = data.get('password')

    if not name or not email or not password:
        return jsonify({'error': 'All fields required'}), 400

    # Normalize email so it's stored consistently (lowercase, no stray spaces)
    email = email.strip().lower()

    if User.query.filter(db.func.lower(User.email) == email).first():
        return jsonify({'error': 'Email already registered'}), 400

    user = User(
        name=name,
        email=email,
        password_hash=generate_password_hash(password)
    )
    db.session.add(user)
    db.session.commit()
    return jsonify({'message': 'Registered successfully', 'id': user.id}), 201


@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    email = (data.get('email') or '').strip().lower()
    password = data.get('password')

    # Case-insensitive email match, so it doesn't matter how the
    # email was capitalized during register vs login.
    user = User.query.filter(db.func.lower(User.email) == email).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Invalid email or password'}), 401

    return jsonify({'message': 'Login successful', 'id': user.id, 'name': user.name}), 200


@app.route('/api/users', methods=['POST'])
def create_user():
    data = request.json
    user = User(
        name=data.get('name'),
        email=data.get('email'),
        study_goal_per_day=data.get('study_goal_per_day', 60)
    )
    db.session.add(user)
    db.session.commit()
    return jsonify({'id': user.id, 'name': user.name, 'email': user.email}), 201


@app.route('/api/users/<int:user_id>', methods=['GET'])
def get_user(user_id):
    user = User.query.get_or_404(user_id)
    return jsonify({
        'id': user.id,
        'name': user.name,
        'email': user.email,
        'study_goal_per_day': user.study_goal_per_day,
        'streak_count': user.streak_count
    })


# ---------------- REMINDER ROUTES ----------------

@app.route('/api/reminders', methods=['GET'])
def get_reminders():
    user_id = request.args.get('user_id')
    if user_id:
        reminders = Reminder.query.filter_by(user_id=user_id).order_by(Reminder.date_time).all()
    else:
        reminders = Reminder.query.order_by(Reminder.date_time).all()
    return jsonify([r.to_dict() for r in reminders])


@app.route('/api/reminders/<int:reminder_id>', methods=['GET'])
def get_reminder(reminder_id):
    reminder = Reminder.query.get_or_404(reminder_id)
    return jsonify(reminder.to_dict())


@app.route('/api/reminders', methods=['POST'])
def create_reminder():
    data = request.json
    reminder = Reminder(
        user_id=data.get('user_id'),
        title=data.get('title'),
        subject=data.get('subject'),
        date_time=datetime.fromisoformat(data.get('date_time')),
        repeat_type=data.get('repeat_type', 'none'),
        priority=data.get('priority', 'medium'),
        notes=data.get('notes', ''),
        reminder_type=data.get('reminder_type', 'study')
    )
    db.session.add(reminder)
    db.session.commit()
    return jsonify(reminder.to_dict()), 201


@app.route('/api/reminders/<int:reminder_id>', methods=['PUT'])
def update_reminder(reminder_id):
    reminder = Reminder.query.get_or_404(reminder_id)
    data = request.json

    reminder.title = data.get('title', reminder.title)
    reminder.subject = data.get('subject', reminder.subject)
    if data.get('date_time'):
        reminder.date_time = datetime.fromisoformat(data.get('date_time'))
    reminder.repeat_type = data.get('repeat_type', reminder.repeat_type)
    reminder.priority = data.get('priority', reminder.priority)
    reminder.is_completed = data.get('is_completed', reminder.is_completed)
    reminder.notes = data.get('notes', reminder.notes)
    reminder.notified = data.get('notified', reminder.notified)

    db.session.commit()
    return jsonify(reminder.to_dict())


@app.route('/api/reminders/<int:reminder_id>', methods=['DELETE'])
def delete_reminder(reminder_id):
    reminder = Reminder.query.get_or_404(reminder_id)
    db.session.delete(reminder)
    db.session.commit()
    return jsonify({'message': 'Reminder deleted'})


@app.route('/api/reminders/<int:reminder_id>/complete', methods=['POST'])
def complete_reminder(reminder_id):
    reminder = Reminder.query.get_or_404(reminder_id)
    data = request.json or {}
    reminder.is_completed = True
    db.session.commit()

    # Study log entry
    log = StudyLog(
        user_id=reminder.user_id,
        reminder_id=reminder.id,
        subject=reminder.subject,
        duration=data.get('duration', 0)
    )
    db.session.add(log)

    # Streak update
    user = User.query.get(reminder.user_id)
    if user:
        user.streak_count += 1
    db.session.commit()

    return jsonify({'message': 'Marked completed', 'reminder': reminder.to_dict()})


# ---------------- TIMETABLE ROUTES ----------------

@app.route('/api/timetable', methods=['GET'])
def get_timetable():
    user_id = request.args.get('user_id')
    slots = Timetable.query.filter_by(user_id=user_id).all()
    return jsonify([s.to_dict() for s in slots])


@app.route('/api/timetable', methods=['POST'])
def create_timetable_slot():
    data = request.json
    slot = Timetable(
        user_id=data.get('user_id'),
        day=data.get('day'),
        start_time=data.get('start'),
        end_time=data.get('end'),
        subject=data.get('subject')
    )
    db.session.add(slot)
    db.session.commit()
    return jsonify(slot.to_dict()), 201


@app.route('/api/timetable/<int:slot_id>', methods=['PUT'])
def update_timetable_slot(slot_id):
    slot = Timetable.query.get_or_404(slot_id)
    data = request.json
    slot.last_notified_date = data.get('last_notified_date', slot.last_notified_date)
    db.session.commit()
    return jsonify(slot.to_dict())


@app.route('/api/timetable/<int:slot_id>', methods=['DELETE'])
def delete_timetable_slot(slot_id):
    slot = Timetable.query.get_or_404(slot_id)
    db.session.delete(slot)
    db.session.commit()
    return jsonify({'message': 'Slot deleted'})


# ---------------- BREAK CYCLE ROUTES ----------------

@app.route('/api/breaks', methods=['GET'])
def get_breaks():
    user_id = request.args.get('user_id')
    breaks = BreakCycle.query.filter_by(user_id=user_id).all()
    return jsonify([b.to_dict() for b in breaks])


@app.route('/api/breaks', methods=['POST'])
def create_break():
    data = request.json
    br = BreakCycle(
        user_id=data.get('user_id'),
        label=data.get('label', 'Break'),
        study_min=data.get('studyMin', 50),
        break_min=data.get('breakMin', 10),
        phase='study',
        phase_end_at=datetime.fromisoformat(data.get('phaseEndAt'))
    )
    db.session.add(br)
    db.session.commit()
    return jsonify(br.to_dict()), 201


@app.route('/api/breaks/<int:break_id>', methods=['PUT'])
def update_break(break_id):
    br = BreakCycle.query.get_or_404(break_id)
    data = request.json
    br.phase = data.get('phase', br.phase)
    if data.get('phaseEndAt'):
        br.phase_end_at = datetime.fromisoformat(data.get('phaseEndAt'))
    db.session.commit()
    return jsonify(br.to_dict())


@app.route('/api/breaks/<int:break_id>', methods=['DELETE'])
def delete_break(break_id):
    br = BreakCycle.query.get_or_404(break_id)
    db.session.delete(br)
    db.session.commit()
    return jsonify({'message': 'Break deleted'})


# ---------------- STATS ROUTES ----------------

@app.route('/api/stats/<int:user_id>', methods=['GET'])
def get_stats(user_id):
    user = User.query.get_or_404(user_id)
    logs = StudyLog.query.filter_by(user_id=user_id).all()

    total_minutes = sum(log.duration or 0 for log in logs)
    subject_wise = {}
    for log in logs:
        subject_wise[log.subject] = subject_wise.get(log.subject, 0) + (log.duration or 0)

    return jsonify({
        'streak_count': user.streak_count,
        'total_study_minutes': total_minutes,
        'subject_wise_minutes': subject_wise
    })


# ---------------- PAGE ROUTES ----------------

@app.route('/')
def home():
    return send_from_directory('.', 'login.html')


@app.route('/login')
def login_page():
    return send_from_directory('.', 'login.html')


@app.route('/register')
def register_page():
    return send_from_directory('.', 'register.html')


@app.route('/dashboard')
def dashboard_page():
    return send_from_directory('.', 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory('.', filename)


# ---------------- MAIN ----------------

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)