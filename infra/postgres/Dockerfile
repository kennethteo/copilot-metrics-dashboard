# Use the official PostgreSQL image from Docker Hub
FROM postgres:15

# Set environment variables for PostgreSQL
ENV POSTGRES_DB=dev_db
ENV POSTGRES_USER=dev_user
ENV POSTGRES_PASSWORD=dev_password

# Expose the default PostgreSQL port
EXPOSE 5432

# Copy initialization scripts (runs only on first init of the volume)
COPY init.sql /docker-entrypoint-initdb.d/
