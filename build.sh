#!/bin/bash

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "Error: .env file not found"
    exit 1
fi

# Set variables
TAG="latest"

# Build the Docker image
echo "Building Docker image..."
docker build -t ${DOCKER_REGISTRY}/${DOCKER_IMAGE_NAME}:${TAG} .

# Push the image to registry
echo "Pushing image to registry..."
docker push ${DOCKER_REGISTRY}/${DOCKER_IMAGE_NAME}:${TAG}

echo "Build and push completed successfully!" 