from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

# ---------------- MODELS ----------------

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    study_goal_per_day = db.Column(db.Integer, default=60)  # minutes
    streak_count = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'study_goal_per_day': self.study_goal_per_day,
            'streak_count': self.streak_count,
            'created_at': self.created_at.isoformat()
        }


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
            'created_at': self.created_at.isoformat()
        }


class StudyLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    reminder_id = db.Column(db.Integer, db.ForeignKey('reminder.id'))
    subject = db.Column(db.String(100))
    duration = db.Column(db.Integer)  # minutes
    date = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'reminder_id': self.reminder_id,
            'subject': self.subject,
            'duration': self.duration,
            'date': self.date.isoformat()
        }