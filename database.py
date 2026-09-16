from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime
from database import db, init_db, User, Reminder, StudyLog

app = Flask(__name__)
CORS(app)

init_db(app)

# ---------------- USER ROUTES ----------------

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
    return jsonify(user.to_dict()), 201


@app.route('/api/users/<int:user_id>', methods=['GET'])
def get_user(user_id):
    user = User.query.get_or_404(user_id)
    return jsonify(user.to_dict())


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
        notes=data.get('notes', '')
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

    log = StudyLog(
        user_id=reminder.user_id,
        reminder_id=reminder.id,
        subject=reminder.subject,
        duration=data.get('duration', 0)
    )
    db.session.add(log)

    user = User.query.get(reminder.user_id)
    if user:
        user.streak_count += 1
    db.session.commit()

    return jsonify({'message': 'Marked completed', 'reminder': reminder.to_dict()})


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


# ---------------- MAIN ----------------

if __name__ == '__main__':
    app.run(debug=True, port=5000)