import json
import os
import pickle
import sys
from dotenv import load_dotenv
from flask import Flask

load_dotenv()

# src/ directory and project root (one level up)
current_directory = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_directory)

if project_root not in sys.path:
    sys.path.insert(0, project_root)

from flask_cors import CORS
from models import db, Episode, Review
from routes import register_routes


#processed directory for math records
processed_directory = os.path.join(project_root, "processed")

# Serve React build files from <project_root>/frontend/dist
app = Flask(__name__,
    static_folder=os.path.join(project_root, 'frontend', 'dist'),
    static_url_path='')
CORS(app)

# Configure SQLite database - using 3 slashes for relative path
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///data.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize database with app
db.init_app(app)

# Register routes
register_routes(app)

# Function to initialize database, change this to your own database initialization logic
def init_db():
    with app.app_context():
        # Create all tables
        db.create_all()
        
        # Initialize database with data from init.json if empty
        if Episode.query.count() == 0:
            json_file_path = os.path.join(current_directory, 'init.json')
            with open(json_file_path, 'r') as file:
                data = json.load(file)
                for episode_data in data['episodes']:
                    episode = Episode(
                        id=episode_data['id'],
                        title=episode_data['title'],
                        descr=episode_data['descr']
                    )
                    db.session.add(episode)
                
                for review_data in data['reviews']:
                    review = Review(
                        id=review_data['id'],
                        imdb_rating=review_data['imdb_rating']
                    )
                    db.session.add(review)
            
            db.session.commit()
            print("Database initialized with episodes and reviews data")

def load_math_artifacts():
    try:
        with open(os.path.join(processed_directory, "math_problems.json"), "r", encoding="utf-8") as file:
            app.config["MATH_RECORDS"] = json.load(file)

        with open(os.path.join(processed_directory, "math_vectorizer.pkl"), "rb") as file:
            app.config["MATH_VECTORIZER"] = pickle.load(file)

        with open(os.path.join(processed_directory, "math_tfidf_matrix.pkl"), "rb") as file:
            app.config["MATH_TFIDF_MATRIX"] = pickle.load(file)
    except FileNotFoundError:
        print("Math retrieval artifacts not found. Run preprocessing and TF-IDF indexing first.")



#init_db()
load_math_artifacts()

if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0", port=5001)
